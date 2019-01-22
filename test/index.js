const mochaSpawn = require('mocha-spawn')
const rewire = require('rewire')
//const Archivist = rewire('../').__get__('ArchivistLib')
var Archivist = require('../')
const path = require('path')
const testPath = path.resolve(__dirname)


describe('Archivist', function () {
    it('can instantiate single archivist with custom options', function (done) {
        var Archivist1 = new Archivist(createNewArchivist("1"))
        /* Archivist.initAsync(createNewArchivist("1"), {}).then(archivist1 => {
            var secretContent1 = archivist1.readSecrets().toString()
            console.log(secretContent1)
            Archivist.initAsync(createNewArchivist("2"), {}).then(archivist2 => {
                var secretContent2 = archivist1.readSecrets().toString()
                console.log(secretContent2)
                done()
            })
        }) */
        console.log("??")
    })
})

function createNewArchivist(cnt){
    return {
        cwd: testPath,
        feedPath: path.resolve(testPath, "feeds"+cnt),
        jsonFeedPath: path.resolve(testPath, "feeds"+cnt+".json"),
        secretsPath: path.resolve(testPath, ".secrets"+cnt),
        archiverPath: path.resolve(testPath, "archiver"+cnt),
        myChannel: "archivist_test"
    }
}