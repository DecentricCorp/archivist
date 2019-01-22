#!/usr/bin/env node
const fs = require('fs-extra')
var Archivist = require('../')
if (fs.existsSync('./settings.json')) {
    var opts = require('./settings.json')
    new Archivist(opts)
} else {
    new Archivist()
}
