var Coval = require('coval.js')
var fp = require("find-free-port")
var Hdkey = new Coval.Coval().Secure.HDKey
var hdkey = new Hdkey()
var HypercoreDaemon = require('hypercored')
var fs = require('fs-extra')
var path = require('path')
var os = require('os')
var LiveFeeds = {shards: [], metadata: []}
var WatchJS = require("melanke-watchjs")
var runningAsScript = !module.parent
var express = require('express')
var PubNub = require('pubnub')
var secretsContent, pubnub, pubnubOptions, bitcore, options
var isRegistered = false
var app = express()
var secretsPath = path.resolve(__dirname, "storage", ".secrets")
const util = require('util')
app.set('json spaces', 4)
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-From")
    next()
})

function preInit(opts, cb){
    
    // check for file on system
    // if no file exists create one
    //      generate hdkey and store locally
    //      broadcast pubkey + address and intent to register
    //      each archivist online can receive the request and sign the pubkey with their private key
    //      each archivist broadcasts signed key back to registrant
    //      each archivist stores known peers

    secretsContent = initSecrets(opts.secretsPath || secretsPath)
    isRegistered = initRegistered(secretsContent)
    console.log("Your Archivist Address is", secretsContent.address)
    console.log("Registered?", isRegistered)
    return cb()
}

function init(opts, eventHooks, cb){
    if (!eventHooks) return init(opts, {}, cb)
    if (!opts) return init({}, eventHooks, cb)
    if (!cb) return init(opts, eventHooks, (self)=>{
        return self
    })
    var _opts = {
        mySubscribeKey: opts.mySubscribeKey || "sub-c-95c943a2-5962-11e4-9632-02ee2ddab7fe", 
        myPublishKey: opts.myPublishKey || "pub-c-a281bc74-72b6-4976-88ec-e039492b0dfa",
        myChannel: opts.myChannel || "dat_archival",
        feedPath: opts.feedPath || path.resolve(__dirname, "storage", 'feeds'),
        jsonFeedPath: opts.jsonFeedPath || path.resolve(__dirname, "storage", 'feeds.json'),
        secretsPath: opts.secretsPath || secretsPath,
        cwd: opts.cwd || path.resolve(__dirname, "storage"),
        archiverPath: opts.archiverPath || path.resolve(__dirname, "storage", "archiver"),
        websockets: true
    }
    options = _opts
    var _eventHooks = {
        read: eventHooks.read || readArchivistFlatFeed, 
        save: eventHooks.save || saveArchivistFeed,
        meta: eventHooks.meta || saveMetadata
    }
    return preInit(_opts, ()=>{        
        secretsPath = _opts.secretsPath
        fs.ensureFileSync(_opts.feedPath)
        fs.ensureFileSync(_opts.jsonFeedPath)
        
        HypercoreDaemon.init(_eventHooks, _opts)
        pubnub = initPubNub(_opts)
        if (!isRegistered) {
            return startRegistration(_opts, ()=>{
                return cb(null, this)
            })
        } else {
            readArchivistFlatFeed('open', (liveFeeds) => {
                feeds.watch('shards', (id, oldval, newval) => {
                    console.log(id, oldval, newval)
                })
            })
        }
        return cb(this)
    })
    
}

function initSecrets(secretsPath){
    bitcore = hdkey.GetBitcore()
    fs.ensureFileSync(secretsPath)
    secretsContent = readSecrets(secretsPath)
    if (secretsContent.length === 0) {        
        hdkey.StandardHDKey('0', function(address, key){
            secretsContent = {address: address, key: key}
            saveSecrets(secretsPath, secretsContent)
        })        
    } else {
        secretsContent = JSON.parse(secretsContent)
        secretsContent.key = bitcore.HDPrivateKey(secretsContent.key)
    }
    return secretsContent
}

function readSecrets(_secretsPath){
    return fs.readFileSync(_secretsPath || secretsPath)
}

function saveSecrets(_secretsPath, secretsContent){
    fs.writeFileSync(_secretsPath || secretsPath, JSON.stringify(secretsContent, null, 4))
}

function initRegistered(secretsContent){
    if (secretsContent.peers && secretsContent.peers.length > 10) {
        return true
    } else {
        return false
    }
}

function startRegistration(opts, self){
    var payload = {
        type: "register",
        address: secretsContent.address,
        pubkey: secretsContent.key.publicKey.toString('hex')
    }
    pubnub.publish({ 
            message: payload,
            channel: options.myChannel || opts.myChannel
        }, 
        function (status) {
            //console.log("msg status", status)
        }
    )
    return self(null, this)
}

function initPubNub(opts){
    pubnubOptions = opts
    pubnub = new PubNub({
        subscribeKey: opts.mySubscribeKey || 'demo',
        publishKey: opts.myPublishKey || 'demo',
        secretKey: opts.secretKey || '',
        ssl: true
    })
    pubnub.addListener({
        status: function (statusEvent) {
            
        },
        message: function (envelope) {
            var payload = envelope.message
            if (payload.type === "register") {
                handleRegisterMsg(payload)
            } else if(payload.type === "register-sign") {
                handleSignedRegisterMsg(payload)
            } else if(payload.type === "roll-call") {
                handleRollCallMsg(payload)
            }
            
        },
        presence: function (presenceEvent) {
            
        }
    })
    pubnub.subscribe({
        channels: [pubnubOptions.myChannel || 'demo'],
    })
    return pubnub
}

function handleRollCallMsg(payload) {

}

function handleSignedRegisterMsg(payload){
    if (!secretsContent.peers) secretsContent.peers = []
    payload.signer.signature = payload.signature
    var forMe = payload.registrant.address === secretsContent.address && secretsContent.peers.filter(peer=>{return peer.signature && peer.signature === payload.signer.signature}).length < 1
    if (forMe) {
        console.log("EPIC someone signed my pubkey", payload)
        var validSignature = verifySignature(secretsContent.key.publicKey.toString('hex'), payload.signature, payload.signer.publicKey)
        if (validSignature) {
            var foundPeer = secretsContent.peers.filter(peer=>{return peer.address === payload.signer.address})
            if (foundPeer.length > 0) {
                foundPeer[0].signature = payload.signer.signature
            } else {
                secretsContent.peers.push(payload.signer)
            }
            saveSecrets(secretsPath, secretsContent)
            console.log("Saved that signer to my secrets")
        }
    } else {
        console.log("Heard my signed registration response")
    }
}

function handleRegisterMsg(payload){
    var isMe = payload.address === secretsContent.address
    if (!isMe) {
        console.log("NEAT someone who isn't me is registering", payload.address, payload.pubkey)
        if (!secretsContent.peers) secretsContent.peers = []
        var foundPeer = secretsContent.peers.filter(peer=>{return peer.address === payload.address})
        if (foundPeer.length < 1) {
            secretsContent.peers.push({address: payload.address, publicKey: payload.pubkey})
            saveSecrets(secretsPath, secretsContent)
        }
        var signature = signString(payload.pubkey, secretsContent.key.privateKey)
        var payload = {
            type: "register-sign",
            registrant: {
                address: payload.address,
                publicKey: payload.pubkey
            },
            signer: {
                address: secretsContent.address, 
                publicKey: secretsContent.key.publicKey.toString('hex')
            },
            signature: signature.toString('hex')
        }
        publishToChannel(payload, status=>{
            if (secretsContent.peers.filter(peer=>{return !peer.signature}).length > 0) {
                startRegistration(options, ()=>{
                    console.log("something")
                })
            }
        })
        
    } else {
        console.log("Heard my registration request")
    }
}

function publishToChannel(payload, cb){
    pubnub.publish({ 
        message: payload,
        channel: options.myChannel || 'dat_archival'
    }, 
    function (status) {
        return cb(status)
    })
}

function signString(msg, pk){
    signature = bitcore.crypto.ECDSA.sign(bitcore.crypto.Hash.sha256(new Buffer(msg)), pk)
    return signature
}

function verifySignature(msg, sig, pubkey){
    var verification = bitcore.crypto.ECDSA.verify(bitcore.crypto.Hash.sha256(new Buffer(msg)), bitcore.crypto.Signature.fromString(sig), bitcore.PublicKey.fromString(pubkey))
    return verification
}

function Feeds(liveFeeds){
    this.LiveFeeds = liveFeeds
}

Feeds.prototype.watch = function(prop,cb){
    return WatchJS.watch(this.LiveFeeds, prop, (__,action,item)=>{
        if (action === 'push') {
            action = 'add'
            saveArchivistFeed(action, item, ()=>{
                console.log('detected change to JSON store',action, item )
            })
        }
    })
}
var feeds = new Feeds(LiveFeeds)

app.get('/info', (req, res)=>{
    var secretContent = JSON.parse(readSecrets())
    res.json({feeds: feeds, secrets: secretContent})
})
app.post('/add', (req, res)=>{
    var toAdd = []
    if (req.query.address) {
        toAdd = [req.query.address]
    }
    if (req.query.addresses) {
        toAdd = JSON.parse(req.query.addresses)        
    }
    toAdd.forEach((item, index)=>{
        if(feeds.LiveFeeds.shards.includes(item)) return
        saveArchivistFeed('add', item, ()=>{
            if (index === toAdd.length -1) {
                res.json({success: true})
            }
        })
    })
})
app.post('/remove', (req, res)=>{
    var toRemove = []
    if (req.query.address) {
        toRemove = [req.query.address]
    }
    if (req.query.addresses) {
        toRemove = JSON.parse(req.query.addresses)        
    }
    toRemove.forEach((item, index)=>{
        if(!feeds.LiveFeeds.shards.includes(item)) return
        saveArchivistFeed('remove', item, ()=>{
            if (index === toRemove.length -1) {
                res.json({success: true})
            }
        })
    })
})
fp(3001, function(err, freePort){
    app.listen(freePort)
    console.log('listening on port', freePort)
})

var initAsync = util.promisify(init)
var ArchivistLib = {
    preInit: preInit,
    init: init,
    initAsync: initAsync,
    initSecrets: initSecrets,
    readSecrets: readSecrets,
    saveSecrets: saveSecrets ,
    initRegistered: initRegistered,
    startRegistration: startRegistration,
    initPubNub: initPubNub,
    handleRollCallMsg: handleRollCallMsg,
    handleSignedRegisterMsg: handleSignedRegisterMsg,
    handleRegisterMsg: handleRegisterMsg,
    publishToChannel: publishToChannel,
    signString: signString,
    verifySignature: verifySignature,
    app: app
}



function ArchivistClass(opts){
    this.options = opts
    this.feeds = feeds
    this.init = init
    ArchivistLib.initAsync(opts).then(instance=>{
        return this
    })    
}
/* module.exports = {
    feeds: feeds,
    init: init
} */

module.exports = ArchivistClass

if (runningAsScript) {
    init()
}

function readArchivistFlatFeed(type, cb){
    if (!cb) return readArchivistFlatFeed(type, ()=>{})
    
    var feedSrc = options.feedPath || path.resolve(__dirname, "storage", 'feeds')
    var feedData = fs.readFileSync(feedSrc).toString()
    if(feedData) {        
        var archivistFeed = fs.readFileSync(feedSrc).toString().trim().split(os.EOL)
        archivistFeed.forEach((item, index)=>{
            if (!LiveFeeds.shards.includes(item)) LiveFeeds.shards.push(item)
            if (index+1 === archivistFeed.length) {
                return cb(LiveFeeds)
            }
        })
    } else {
        return cb(LiveFeeds)
    }
}

function saveMetadata(type, keyHex, content){
    var feedJsonSrc = options.jsonFeedPath || path.resolve(__dirname, "storage", 'feeds.json')
    if (type === 'add') {
        if (feeds.LiveFeeds.metadata.filter(item=>{return item.key === keyHex }).length < 1) {
            feeds.LiveFeeds.metadata.push({key: keyHex, content: JSON.parse(content)})
            fs.writeFileSync(feedJsonSrc, JSON.stringify(feeds.LiveFeeds, null, 4))
        }
    } else if(type === 'remove') {
        if (feeds.LiveFeeds.metadata.filter(item=>{return item.key === keyHex }).length > 0) {
            feeds.LiveFeeds.metadata = feeds.LiveFeeds.metadata.filter(item=>{ return item.key !== keyHex})
            fs.writeFileSync(feedJsonSrc, JSON.stringify(feeds.LiveFeeds, null, 4))
        }
    }
}

function saveArchivistFeed(type, keyHex, cb){
    if (!cb) return saveArchivistFeed(type, feed, ()=>{})
    var feedSrc = options.feedPath || path.resolve(__dirname, "storage", 'feeds')
    var feedJsonSrc = options.jsonFeedPath || path.resolve(__dirname, "storage", 'feeds.json')
    var feedData = []
    
    if (type === 'remove' && feeds.LiveFeeds.shards.includes(keyHex)) {
        var tempFeed = feeds.LiveFeeds.shards.filter(shard=>{return shard !== keyHex})
        feeds.LiveFeeds.shards = tempFeed
    }
    if (type === 'add') {
        if (!feedData.includes(keyHex)) feedData.push(keyHex)
        if (!feeds.LiveFeeds.shards.includes(keyHex)) feeds.LiveFeeds.shards.push(keyHex)
    }
    if (feeds.LiveFeeds.shards.length > 0) {
        feeds.LiveFeeds.shards.forEach((shard, index)=>{
            if (!feedData.includes(shard)) feedData.push(shard)
            if (index+1 === feeds.LiveFeeds.shards.length) {
                fs.writeFileSync(feedJsonSrc, JSON.stringify(feeds.LiveFeeds, null, 4))
                var feedContent = fs.readFileSync(feedSrc).toString()
                var isSame = (feedContent === feedData.join(os.EOL))
                if (!isSame) {
                    fs.writeFile(feedSrc, feedData.join(os.EOL), err=>{
                        return cb(feedData)
                    })
                } else {
                    return cb(feedData)
                }         
            }
        })
    } else {
        fs.writeFile(feedSrc, feedData.join(os.EOL), err=>{
            fs.writeFileSync(feedJsonSrc, JSON.stringify(feeds.LiveFeeds, null, 4))
            return cb(feedData)
        })
    }
}
