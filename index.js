'use strict';

var fs = require('fs');
var async = require('async');
var plist = require('simple-plist');
var decompress = require('decompress-zip');
var provisioning = require('provisioning');
var entitlements = require('entitlements');

var rimraf = require('rimraf');
var tmp = require('temporary');
var glob = require("glob");

var output = new tmp.Dir();

module.exports = function (file, callback){
  var data = {};

  var unzipper = new decompress(file);
  unzipper.extract({
    path: output.path
  });

  unzipper.on('error', cleanUp);
  unzipper.on('extract', function() {
    var path = glob.sync(output.path + '/Payload/*/')[0];

    data.metadata = plist.readFileSync(path + 'Info.plist');
    var iconFiles = [].concat(((data.metadata['CFBundleIcons~ipad'] || {}).CFBundlePrimaryIcon || {}).CFBundleIconFiles, ((data.metadata.CFBundleIcons || {}).CFBundlePrimaryIcon || {}).CFBundleIconFiles, data.metadata.CFBundleIconFiles);
    var biggestIcon = iconFiles.reduce(function(biggest, current) {
      if (typeof current !== "string" || !fs.existsSync(path + current)) {
        return biggest;
      }

      if (biggest === null) {
        return {
          name: current,
          stats: fs.statSync(path + current)
        }
      }

      var stats = fs.statSync(path + current);
      if (stats.size > biggest.stats.size) {
        return {
          name: current,
          stats: stats
        }
      }

      return biggest;
    }, null);

    if (biggestIcon !== null && biggestIcon.stats.isFile()) {
      data.iconImage = fs.readFileSync(path + biggestIcon.name);
    }

    var tasks = [
      async.apply(provisioning, path + 'embedded.mobileprovision')
    ];

    // `entitlements` relies on a OS X only CLI tool called `codesign`
    if(process.platform === 'darwin'){
      tasks.push(async.apply(entitlements, path));
    }

    async.parallel(tasks, function(error, results){
      if(error){
        return cleanUp(error);
      }

      data.provisioning = results[0];

      // Hard to serialize and it looks messy in output
      delete data.provisioning.DeveloperCertificates;

      // Will be undefined on non-OSX platforms
      data.entitlements = results[1];

      return cleanUp();
    });
  });

  function cleanUp(error){
    rimraf.sync(output.path);
    return callback(error, data);
  }
};
