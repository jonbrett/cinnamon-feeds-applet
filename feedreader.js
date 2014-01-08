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
        try {
            Util.spawnCommandLine('xdg-open ' + this.link);
        } catch (e) {
            global.logError(e);
        }
        this.mark_read();
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

    _init: function(url, path, callbacks) {

        this.url = url;
        this.path = path;
        this.callbacks = callbacks;
        this.error = false;

        /* Feed data */
        this.title = "";
        this.description = "";
        this.link = "";
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
        let msg = Soup.Message.new('GET', this.url);

        /* Reset error state */
        this.error = false;

        this.session.queue_message(msg,
                Lang.bind(this, this._on_get_response));
    },

    process_rss: function(feed) {
        /* Get channel data */
        this.title = String(feed..channel.title);
        this.description = String(feed..channel.description);
        this.link = String(feed..channel.link);
        this.image.url = String(feed..channel.image.url);
        this.image.width = String(feed..channel.image.width);
        this.image.height = String(feed..channel.image.height);

        /* Get item list */
        let feed_items = feed..channel.item;
        let new_items = new Array();
        for (var i = 0; i < feed_items.length(); i++) {
            /* guid is optional in RSS spec, so use link as
             * identifier if it's not present */
            let id = String(feed_items[i].guid);
            if (id == '')
                id = feed_items[i].link;

            new_items.push(new FeedItem(
                    id,
                    String(feed_items[i].title),
                    String(feed_items[i].link),
                    String(feed_items[i].description),
                    false,
                    this));
        }
        return new_items;
    },

    process_atom: function(feed) {
        /* Construct Atom XML namespace using uri from the feed in case the
         * feed uses a non-standard uri. Normally this would be
         * http://www.w3.org/2005/Atom */
        let atomns = new Namespace(feed.name().uri);

        /* Get channel data */
        this.title = String(feed.atomns::title);
        this.description = String(feed.atomns::subtitle);
        this.link = String(feed.atomns::link.(@rel == "alternate").@href);
        this.image.url = String(feed.atomns::logo);

        /* Get items */
        let feed_items = feed.atomns::entry;
        let new_items = new Array();
        for (var i = 0; i < feed_items.length(); i++) {
            new_items.push(new FeedItem(
                    String(feed_items[i].atomns::id),
                    String(feed_items[i].atomns::title),
                    String(feed_items[i].atomns::link.(@rel== "alternate").@href),
                    String(feed_items[i].atomns::summary),
                    false,
                    this));
        }
        return new_items;
    },

    _on_get_response: function(session, message) {
        if (message.status_code != 200) {
            return this.on_error('Unable to download feed',
                    'Received HTTP ' + message.status_code + ' from ' + this.url);
        }

        try {
            var feed = new XML(message.response_body.data.replace(
                    /^<\?xml\s+.*\?>/g, ''));
        } catch (e) {
            return this.on_error('Failed to parse feed XML', e);
        }

        /* Determine feed type and parse */
        if (feed.name().localName == "rss") {
            var new_items = this.process_rss(feed);
        } else {
            if (feed.name().localName == "feed") {
                var new_items = this.process_atom(feed);
            } else {
                return this.on_error("Unknown feed type", this.url);
            }
        }

        if (new_items.length < 1) {
            return this.on_error("Unable to read feed contents", this.url);
        }

        /* Fetch image */
        this._fetch_image();

        /* Is this item in the old list or a new item
         * For existing items, transfer "read" property
         * For new items, check against the loaded historic read list */
        var new_count = 0;
        var unread_item = false;
        for (var i = 0; i < new_items.length; i++) {
            let existing = this._get_item_by_id(new_items[i].id);
            if (existing != null) {
                new_items[i].read = existing.read
            } else {
                if (this._is_in_read_list(new_items[i].id)) {
                    new_items[i].read = true;
                } else {
                    unread_item = true;
                }
                new_count++;
                /* if there were no existing entries, assume this is startup */
                startup = true;
            }
        }

        /* Were there any new items? */
        if (new_count > 0) {
            global.log("Fetched " + new_count + " new items from " + this.url);
            this.items = new_items;
            this.callbacks.onUpdate();
            if(unread_item) {
                this.callbacks.onNewItem(this.title, "Unread item!");
            }
        }
        return 0;
    },

    mark_all_items_read: function() {
        for (var i = 0; i < this.items.length; i++)
            this.items[i].mark_read();
        this.save_items();
    },

    save_items: function() {
        try {
            var dir = Gio.file_parse_name(this.path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            /* Write feed items read list to a file as JSON.
             * I found escaping the string helps to deal with special
             * characters, which could cause problems when parsing the file
             * later */
            var file = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url));
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
        try {
            let path = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url)).get_path();
            var content = Cinnamon.get_file_contents_utf8_sync(path);
        } catch (e) {
            /* This is fine for new feeds */
            return;
        }

        try {
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
        global.logError("Feedreader (" + this.url +"): " + msg);

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
    return html.replace('<br/>', '\n').replace('</p>','\n').replace(/<\/h[0-9]>/g, '\n\n').replace(/<.*?>/g, '').replace('&nbsp;', ' ');
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
