/*
 * Cinnamon RSS feed reader (backend)
 *
 * Author: jonbrett.dev@gmail.com
 * Date: 2013
 *
 * Cinnamon RSS feed reader is free software: you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * Cinnamon RSS feed reader is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General
 * Public License for more details.  You should have received a copy of the GNU
 * General Public License along with Cinnamon RSS feed reader.  If not, see
 * <http://www.gnu.org/licenses/>.
 */

const ByteArray = imports.byteArray;
const Cinnamon = imports.gi.Cinnamon;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Soup = imports.gi.Soup;
const Util = imports.misc.util;
const _ = Gettext.gettext;
const Signals = imports.signals;

const APPLET_PATH = imports.ui.appletManager.appletMeta["feeds@jonbrettdev.wordpress.com"].path;

/* Maximum number of "cached" feed items to keep for this feed.
 * Older items will be trimmed first */
const MAX_FEED_ITEMS = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
/* FeedItem objects are used to store data for a single item in a news feed */
function FeedItem() {
    this._init.apply(this, arguments);
}

FeedItem.prototype = {

    _init: function(id, title, link, description, description_text, published) {
        this.id = id;
        this.title = title;
        this.link = link;
        this.description = description;
        this.description_text = description_text;
        this.published = published;
        this.read = false;
        this.deleted = false;
    },

    open: function() {
        try {
            Util.spawnCommandLine('xdg-open ' + this.link);
        } catch (e) {
            global.logError(e);
        }
        this.mark_read();
    },

    mark_read: function(single = true) {
        this.read = true;
        // Only notify when marking individual items
        if(single)
            this.emit('item-read');
    },

    delete_item: function() {
        this.deleted = true;
        this.emit('item-deleted');
    },
}
Signals.addSignalMethods(FeedItem.prototype);

function FeedReader() {
    this._init.apply(this, arguments);
}

FeedReader.prototype = {

    _init: function(logger, url, path, callbacks) {
        this.item_status = new Array();
        this.url = url;
        this.path = path;
        this.callbacks = callbacks;
        this.error = false;
        this.logger = logger;

        /* Feed data */
        this.title = "";
        this.items = new Array();
        //this.read_list = new Array();

        this.image = {}

        /* Init HTTP session */
        try {
            this.session = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(this.session,
                    new Soup.ProxyResolverDefault());
        } catch (e) {
            throw "Failed to create HTTP session: " + e;
        }

        /* Load items */
        this.load_items();
    },

    get: function() {
        this.logger.debug("FeedReader.get");
        Util.spawn_async(['python', APPLET_PATH+'/getFeed.py', this.url], Lang.bind(this, this.process_feed));
    },
    
    process_feed: function(response) {
        this.logger.debug("FeedReader.process_feed");

        let start = new Date().getTime(); // Temp timer for gathering info of performance changes
        let new_items = [];
        let new_count = 0;
        let unread_items = [];

        try{
            let info = JSON.parse(response);
            this.title = info.title;
            this.logger.debug("Processing feed: " + info.title);
            // Look for new items
            for (let i = 0; i < info.entries.length; i++) {
                // We only need to process new items, so check if the item exists already
                let existing = this._get_item_by_id(info.entries[i].id);

                if(existing == null){
                    // not found, add to new item list.
                    let published = new Date(info.entries[i].pubDate);
                    // format title once as text
                    let title = this.html2text(info.entries[i].title);

                    // Store the description once as text and once as panjo
                    let description_text = this.html2text(info.entries[i].description).substring(0,MAX_DESCRIPTION_LENGTH);
                    let description = this.html2pango(info.entries[i].description).substring(0,MAX_DESCRIPTION_LENGTH);

                    let item = new FeedItem(info.entries[i].id,
                                            title,
                                            info.entries[i].link,
                                            description,
                                            description_text,
                                            published
                                   );

                    // Connect the events
                    item.connect('item-read', Lang.bind(this, function() { this.on_item_read(); }));
                    item.connect('item-deleted', Lang.bind(this, function() { this.on_item_deleted(); }));



                    // check if already read
                    if(this._is_item_read(item.id)){
                        item.read = true;
                        this.logger.debug("Item Read!");
                    } else {
                        unread_items.push(item);
                        this.logger.debug("Item NOT Read!");
                    }

                    new_items.push(item);
                } else {
                    // Existing item, reuse the item for now.
                    new_items.push(existing);
                }
            }
        } catch (e) {
            this.logger.error(e);
            this.logger.debug(response);
        }
        /* Were there any new items? */
        if (unread_items.length > 0) {
            global.log("Fetched " + unread_items.length + " new items from " + this.url);
            try{
                this.items = new_items;
                this.callbacks.onUpdate();

                if(unread_items.length == 1) {
                    this.callbacks.onNewItem(this.title, unread_items[0].title);
                } else if(unread_items.length > 1) {
                    this.callbacks.onNewItem(this.title, unread_items.length + " unread items!");
                }
                // Update the saved items so we can keep track of new and unread items.
                this.save_items();
            } catch (e){
                this.logger.error(e);
            }
        }

        // Make items available even on the first load.
        if (this.items.length == 0 && new_items.length > 0){
            this.items = new_items;
            this.callbacks.onUpdate();
        }

        let time =  new Date().getTime() - start;

        this.logger.debug("Processing Items took: " + time + " ms");

    },

    mark_all_items_read: function() {
        this.logger.debug("FeedReader.mark_all_items_read");

        for (var i = 0; i < this.items.length; i++)
            this.items[i].mark_read(false);

        this.save_items();
    },

    on_item_read: function() {
        this.logger.debug("FeedReader.on_item_read");
        this.save_items();
    },

    on_item_deleted: function() {
        this.logger.debug("FeedReader.on_item_deleted");
        this.save_items();
    },

    save_items: function(){
        this.logger.debug("FeedReader.save_items");
        try {
            var dir = Gio.file_parse_name(this.path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            /* Write feed items read list to a file as JSON.
             * I found escaping the string helps to deal with special
             * characters, which could cause problems when parsing the file
             * later */
            var filename = this.path + '/' + sanitize_url(this.url);
            this.logger.debug("saving feed data to: " + filename);

            var file = Gio.file_parse_name(filename);

            var fs = file.replace(null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            let item_list = [];
            for (var i = 0; i < this.items.length; i++) {
                item_list.push({
                    "id": this.items[i].id,
                    "read": this.items[i].read,
                    "deleted": this.items[i].deleted,
                });
            }

            // Update the item status
            this.item_status = item_list;

            let data = {
                "feed_title": this.title,
                "item_list": item_list,
            };

            let output = escape(JSON.stringify(data));

            let to_write = output.length;
            while (to_write > 0) {
                to_write -= fs.write(output , null);
            }
            fs.close(null);
        } catch (e) {
            global.logError('Failed to write feed file ' + e);
        }
    },

    // Version 2 will load all items which have been saved to file.
    load_items: function() {
        this.logger.debug("FeedReader.load_items");
        try {
            let path = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url)).get_path();
            //var content = Cinnamon.get_file_contents_utf8_sync(path);
            var content = Cinnamon.get_file_contents_utf8_sync(path);
        } catch (e) {
            /* This is fine for new feeds */
            this.logger.debug("No file found - Assuming new feed.")
            return;
        }

        try {
            this.logger.debug("Loading already fetched feed items");
            var data = JSON.parse(unescape(content));

            if (typeof data == "object") {
                /* Load feedreader data */
                if (data.feed_title != undefined)
                    this.title = data.feed_title;
                else
                    this.title = _("Loading feed");

                if (data.item_list != undefined)
                    this.item_status = data.item_list;
                else
                    this.item_status = new Array();

                this.logger.debug("Number Loaded: " + this.item_status.length);
            } else {
                global.logError('Invalid data file for ' + this.url);
            }
        } catch (e) {
            /* Invalid file contents */
            global.logError('Failed to read feed data file for ' + this.url + ':' + e);
        }
    },

    get_unread_count: function() {
        let count = 0;
        for (var i = 0; i < this.item_status.length; i++) {
            if (!this.item_status[i].read){
                count++;
            }
        }
        return count;
    },

    _get_item_by_id: function(id) {
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i].id == id)
                return this.items[i];
        }
        return null;
    },

    _is_item_read: function(id){
        this.logger.debug("Total Read Items: " + this.item_status.length);
        this.logger.debug("Searching for: " + id);
        for (var i = 0; i < this.item_status.length; i++) {
            if (this.item_status[i].id == id && this.item_status[i].read)
                return true;
        }
        return false;
    },
    /* Fatal error handler
     *
     * Log error state and report to application
     */
    on_error: function(msg, details) {
        this.logger.error("FeedReader (" + this.url +"): " + msg);
        this.error = true;
        this.error_messsage = msg;
        this.error_details = details;

        if (this.callbacks.onError)
            this.callbacks.onError(this, msg, details);

        return 1;
    },

    html2text: function(html) {
        /* Convert html to plaintext */
        let ret = html.replace('<br/>', '\n');
        ret = ret.replace('</p>','\n');
        ret = ret.replace(/<\/h[0-9]>/g, '\n\n');
        ret = ret.replace(/<.*?>/g, '');
        ret = ret.replace('&nbsp;', ' ');
        ret = ret.replace('&quot;', '"');
        ret = ret.replace('&rdquo;', '"');
        ret = ret.replace('&ldquo;', '"');
        ret = ret.replace('&#8220;', '"');
        ret = ret.replace('&#8221;', '"');
        ret = ret.replace('&rsquo;', '\'');
        ret = ret.replace('&lsquo;', '\'');
        ret = ret.replace('&#8216;', '\'');
        ret = ret.replace('&#8217;', '\'');
        ret = ret.replace('&#8230;', '...');
        return ret;
    },

    html2pango: function(html){
        let ret = html;
        let esc_open = '-@~]';
        let esc_close= ']~@-';

        /* </p> <br/> --> newline */
        ret = ret.replace('<br/>', '\n').replace('</p>','\n');

        /* &nbsp; --> space */
        ret = ret.replace(/&nbsp;/g, ' ');

        /* Headings --> <b> + 2*newline */
        ret = ret.replace(/<h[0-9]>/g, esc_open+'span weight="bold"'+esc_close);
        ret = ret.replace(/<\/h[0-9]>\s*/g, esc_open+'/span'+esc_close+'\n\n');

        /* <strong> -> <b> */
        ret = ret.replace('<strong>', esc_open+'b'+esc_close);
        ret = ret.replace('</strong>', esc_open+'/b'+esc_close);

        /* <i> -> <i> */
        ret = ret.replace('<i>', esc_open+'i'+esc_close);
        ret = ret.replace('</i>', esc_open+'/i'+esc_close);

        /* Strip remaining tags */
        ret = ret.replace(/<.*?>/g, '');

        /* Replace escaped <, > with actual angle-brackets */
        let re1 = new RegExp(esc_open, 'g');
        let re2 = new RegExp(esc_close, 'g');
        ret = ret.replace(re1, '<').replace(re2, '>');

        return ret;
    },
};

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
