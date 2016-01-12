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

const APPLET_PATH = imports.ui.appletManager.appletMeta["feeds@jonbrettdev.wordpress.com"].path;

/* Maximum number of "cached" feed items to keep for this feed.
 * Older items will be trimmed first */
const MAX_FEED_ITEMS = 100;

/* FeedItem objects are used to store data for a single item in a news feed */
function FeedItem() {
    this._init.apply(this, arguments);
}

FeedItem.prototype = {

    _init: function(id, title, link, description, read, reader) {
        this.id = id;
        this.title = title;
        this.link = link;
        this.description = description;
        this.read = read;

        this.reader = reader;
    },

    open: function() {
        //this.reader.logger.debug("FeedItem.open");
        try {
            Util.spawnCommandLine('xdg-open ' + this.link);
        } catch (e) {
            global.logError(e);
        }
        this.mark_read();
        //this.reader.logger.debug("FeedItem.open calling save_items");
        this.reader.save_items();
    },

    mark_read: function() {
        this.read = true;
    }
}

function FeedReader() {
    this._init.apply(this, arguments);
}

FeedReader.prototype = {

    _init: function(logger, url, path, callbacks) {

        this.url = url;
        this.path = path;
        this.callbacks = callbacks;
        this.error = false;
        this.logger = logger;

        /* Feed data */
        this.title = "";
        this.items = new Array();
        this.read_list = new Array();
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
        let new_items = [];
        try{
            this.info = JSON.parse(response);
            this.title = this.info.title;
            if (this.info.image) this.image = this.info.image;
            let entries = this.info.entries;



            for (let i = 0; i < entries.length; i++) {
                new_items.push(new FeedItem(entries[i].id, entries[i].title, entries[i].link, entries[i].description, false, this));
            }

            /* Fetch image */
            //this._fetch_image();

            /* Is this item in the old list or a new item
             * For existing items, transfer "read" property
             * For new items, check against the loaded historic read list */
            var new_count = 0;
            var unread_items = [];
            for (var i = 0; i < new_items.length; i++) {
                let existing = this._get_item_by_id(new_items[i].id);
                if (existing != null) {
                    new_items[i].read = existing.read
                } else {
                    if (this._is_in_read_list(new_items[i].id)) {
                        new_items[i].read = true;
                    } else {
                        unread_items.push(new_items[i]);
                    }
                    new_count++;
                }
            }
        } catch (e) {
            this.logger.error(e);
            this.logger.debug(response);
        }
        /* Were there any new items? */
        if (new_count > 0) {
            global.log("Fetched " + new_count + " new items from " + this.url);
            try{
                this.items = new_items;
                this.callbacks.onUpdate();

                if(unread_items.length == 1) {
                    this.callbacks.onNewItem(this.title, unread_items[0].title);
                } else if(unread_items.length > 1) {
                    this.callbacks.onNewItem(this.title, unread_items.length + " unread items!");
                }
            } catch (e){
                this.logger.error(e);
            }
        }
    },

    mark_all_items_read: function() {
        this.logger.debug("FeedReader.mark_all_items_read");
        for (var i = 0; i < this.items.length; i++)
            this.items[i].mark_read();
        this.save_items();
    },

    save_items: function() {
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

            let read_list = [];
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].read == true)
                    read_list.push({ "id" : this.items[i].id });
            }

            var data = {
                "title": this.title,
                "read_list": read_list,
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

    load_items: function() {
        this.logger.debug("FeedReader.load_items");
        try {
            let path = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url)).get_path();
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
                if (data.title != undefined)
                    this.title = data.title;
                else
                    this.title = _("Loading feed");

                if (data.read_list != undefined)
                    this.read_list = data.read_list;
                else
                    this.read_list = new Array();
            } else {
                global.logError('Invalid data file for ' + this.url);
            }
        } catch (e) {
            /* Invalid file contents */
            global.logError('Failed to read feed data file for ' + this.url + ':' + e);
        }
    },

    _fetch_image: function() {
        this.logger.debug("FeedReader._fetch_image");
        if (this.image.url == undefined || this.image.url == '')
            return;

        /* Use local file if it already exists */
        let f = Gio.file_parse_name(this.path + '/' + sanitize_url(this.image.url));
        if (f.query_exists(null)) {
            this.image.path = f.get_path();
            return;
        }

        /* Request image url */
        let msg = Soup.Message.new('GET', this.image.url);
        this.session.queue_message(msg,
                Lang.bind(this, this._on_img_response));
    },

    _on_img_response: function(session, message) {
        this.logger.debug("FeedReader._on_img_response");
        if (message.status_code != 200) {
            global.logError('HTTP request for ' + this.url + ' returned ' + message.status_code);
            return;
        }

        try {
            var dir = Gio.file_parse_name(this.path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            let file = Gio.file_parse_name(this.path + '/' + sanitize_url(this.image.url));
            let fs = file.replace(null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            var to_write = message.response_body.length;
            while (to_write > 0) {
                to_write -= fs.write(message.response_body.get_chunk(message.response_body.length - to_write).get_data(),
                        null, to_write);
            }
            fs.close(null);

            this.image.path = file.get_path();
            this.callbacks.onUpdate();
        } catch (e) {
            global.log("Error saving feed image for " + this.url + ": " + e);
            this.image.path = undefined;
        }
    },

    _get_item_by_id: function(id) {
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i].id == id)
                return this.items[i];
        }
        return null;
    },

    _is_in_read_list: function(id) {
        for (var i = 0; i < this.read_list.length; i++) {
            if (this.read_list[i].id == id)
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
};

/* Convert html to plaintext */
function html2text(html) {
    return html.replace('<br/>', '\n').replace('</p>','\n').replace(/<\/h[0-9]>/g, '\n\n').replace(/<.*?>/g, '').replace('&nbsp;', ' ').replace('&quot;', '"').replace('&rdquo;', '"').replace('&ldquo;', '"').replace('&#8220;', '"').replace('&#8221;', '"').replace('&rsquo;', '\'').replace('&lsquo;', '\'').replace('&#8216;', '\'').replace('&#8217;', '\'').replace('&#8230;', '...');
}

/* Convert html to (basic) Gnome Pango markup */
function html2pango(html) {
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
}

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
