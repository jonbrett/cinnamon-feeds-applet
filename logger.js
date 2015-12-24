/**
* Logger utility to allow the user to enable debug logging on the fly.
**/

function Logger(options) {
    this.uuid = options.uuid || "";
    this.verbose = options.verbose || false;
}

Logger.prototype.debug = function(msg) {
    // Only log when verbose logging is enabled
    if(this.verbose){
        global.log(this.uuid + " :: " + msg);
    }
}

Logger.prototype.info = function(msg) {
    // always display info logging
    global.log(this.uuid + " :: " + msg);
}

Logger.prototype.error = function(msg) {
    // always display error logging
    global.logError(this.uuid + " :: ERROR :: " + msg);
}