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

 Logger.prototype.error = function(msg) {
    global.logError(this.uuid + " :: ERROR :: " + msg);
 }