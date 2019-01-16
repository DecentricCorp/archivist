var HypercoreDaemon = require('hypercored')
var fs = require('fs-extra')
var path = require('path')
var os = require('os')
var LiveFeeds = {shards: [], metadata: []}
var WatchJS = require("melanke-watchjs")
var runningAsScript = !module.parent
var express = require('express')

var app = express()
app.set('json spaces', 4)
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-From")
    next()
})


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
        console.log()
    })
}
var feeds = new Feeds(LiveFeeds)
app.get('/info', (req, res)=>{
    res.json(feeds)
})
app.listen(3001)

function init(opts, eventHooks){
    var _opts = {
        mySubscribeKey: "sub-c-95c943a2-5962-11e4-9632-02ee2ddab7fe", 
        myPublishKey: "pub-c-a281bc74-72b6-4976-88ec-e039492b0dfa",
        myChannel: "dat_archival",
        /* feedPath: path.resolve(__dirname, 'feeds') */
    }
    var _eventHooks = {
        read: readArchivistFlatFeed, 
        save: saveArchivistFeed,
        meta: saveMetadata
    }

    var feedFilePath = path.resolve(__dirname, 'feeds')
    var feedJsonFilePath = path.resolve(__dirname, 'feeds.json')
    fs.ensureFileSync(feedFilePath)
    fs.ensureFileSync(feedJsonFilePath)
    
    HypercoreDaemon.init(eventHooks || _eventHooks, opts || _opts)
    readArchivistFlatFeed('open', (liveFeeds) => {
        feeds.watch('shards', (id, oldval, newval) => {
            console.log(id, oldval, newval)
        })
    })
}


module.exports = {
    feeds: feeds,
    init: init
}

if (runningAsScript) {
    init()
}



function readArchivistFlatFeed(type, cb){
    if (!cb) return readArchivistFlatFeed(type, ()=>{})
    
    var feedSrc = path.resolve(__dirname, 'feeds')
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
    var feedJsonSrc = path.resolve(__dirname, 'feeds.json')
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
    var feedSrc = path.resolve(__dirname, 'feeds')
    var feedJsonSrc = path.resolve(__dirname, 'feeds.json')
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
        fs.writeFileSync(feedJsonSrc, JSON.stringify(feeds.LiveFeeds, null, 4))
        return cb(feedData)
    }
}