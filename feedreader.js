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

const Cinnamon = imports.gi.Cinnamon;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Gio = imports.gi.Gio;
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

    _init: function(url, path, max_item, callbacks) {

        this.url = url;
        this.path = path;
        this.max_item = max_item;
        this.callbacks = callbacks;

        /* Feed data */
        this.title = "";
        this.description = "";
        this.link = "";
        this.items = new Array();
        this.read_list = new Array();

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

        this.session.queue_message(msg,
                Lang.bind(this, this._on_get_response));
    },

    _on_get_response: function(session, message) {
        if (message.status_code != 200) {
            global.log('HTTP request returned ' + message.status_code);
            return;
        }

        try {
            var feed = new XML(message.response_body.data.replace(
                    /^<\?xml\s+.*\?>/g, ''));
        } catch (e) {
            global.log('Failed to parse XML ' + e);
        }

        /* Process RSS to update channel data */
        this.title = String(feed..channel.title);
        this.description = String(feed..channel.description);
        this.link = String(feed..channel.link);

        var rss_item = feed..channel.item;
        var new_items = new Array();
        var new_count = 0;

        for (var i = 0; i < rss_item.length(); i++) {
            /* guid is optional in RSS spec, so use link as
             * identifier if it's not present */
            let id = String(rss_item[i].guid);
            if (id == '')
                id = rss_item[i].link;

            new_items.push(new FeedItem(
                    id,
                    String(rss_item[i].title),
                    String(rss_item[i].link),
                    String(rss_item[i].description),
                    false,
                    this));

            /* Is this item in the old list or a new item
             * For existing items, transfer "read" property
             * For new items, check against the loaded historic read list */
            let existing = this._get_item_by_id(id);
            if (existing != null) {
                new_items[i].read = existing.read
            } else {
                if (this._is_in_read_list(id))
                    new_items[i].read = true;
                new_count++;
            }
        }

        /* Were there any new items? */
        if (new_count > 0) {
            global.log("Fetched " + new_count + " new items (" + new_items.length + " total) from " + this.url);
            this.items = new_items;
            this.callbacks.onUpdate();
        }
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

            fs.write(escape(JSON.stringify(data)), null);
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
};

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
