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
        this.read = true;
        try {
            Util.spawnCommandLine('xdg-open ' + this.link);
        } catch (e) {
            global.logError(e);
        }
        this.reader.save_items();
    },
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

        for (var i = 0; i < rss_item.length(); i++) {
            /* guid is optional in RSS spec, so use link as
             * identifier if it's not present */
            let id = String(rss_item[i].guid);
            if (id == '')
                id = rss_item[i].link

            new_items.push(new FeedItem(
                    id,
                    String(rss_item[i].title),
                    String(rss_item[i].link),
                    String(rss_item[i].description),
                    false,
                    this));
        }

        /* We are only interested in new items that we haven't seen before */
        if (this._add_items(new_items) > 0) {
            this.prune_items();
            this.save_items();
            this.callbacks.onUpdate();
        }
    },

    mark_item_read: function(id) {
        var item = this._get_item_by_id(id);
        if (item != null) {
            item.read = true;
            this.save_items();
        }
    },

    mark_all_items_read: function() {
        for (var i = 0; i < this.items.length; i++)
            this.items[i].read = true;
        this.save_items();
    },

    save_items: function() {
        try {
            var dir = Gio.file_new_for_path(this.path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            /* Write feed items to a file as JSON.
             * I found escaping the string helps to deal with special
             * characters, which could cause problems when parsing the file
             * later */
            var file = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url));
            var fs = file.replace(null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            /* We convert the items array into a more simple
             * array that contains only the necessary info to
             * recreate each item. I.e. we do not store
             * run-time references to other objects */
            var simple_items = new Array();
            for (var i = 0; i < this.items.length; i++) {
                simple_items.push({
                    "id": this.items[i].id,
                    "title": this.items[i].title,
                    "link": this.items[i].link,
                    "description": this.items[i].description,
                    "read": this.items[i].read,
                });
            }
            var data = {
                "title": this.title,
                "link": this.link,
                "description": this.description,
                "items": simple_items,
            };

            fs.write(escape(JSON.stringify(data)), null);
            fs.close(null);
        } catch (e) {
            global.logError('Failed to write feed file ' + e);
        }
    },

    load_items: function() {
        try {
            var file = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url));
            var fs = file.open_readwrite(null);
        } catch (e) {
            /* File doesn't exist yet. This is expected for a
             * new feed */
            return;
        }

        try {
            var content = Cinnamon.get_file_contents_utf8_sync(
                    this.path + '/' + sanitize_url(this.url));
            var data = JSON.parse(unescape(content));

            if (typeof data == "object") {

                /* Load feedreader data */
                if (data.title != undefined)
                    this.title = data.title;
                else
                    this.title = _("Loading feed");

                if (data.link != undefined)
                    this.link = data.link;

                if (data.description != undefined)
                    this.description = data.description;

                this.items = new Array();
                if (data.items != undefined)
                    for (var i = 0; i < data.items.length; i++)
                        this.items.push(new FeedItem(
                                    data.items[i].id,
                                    data.items[i].title,
                                    data.items[i].link,
                                    data.items[i].description,
                                    data.items[i].read,
                                    this));
            } else {
                global.logError('Invalid data file for ' + this.url);
            }
        } catch (e) {
            /* Invalid file contents */
            global.logError('Failed to read feed data file for ' + this.url + ':' + e);
        }

        global.log('Loaded ' + this.items.length + ' items for ' + this.url);
    },

    _add_items: function(items) {
        var new_items = []
        for (var i = 0; i < items.length; i++) {
            if (this._get_item_by_id(items[i].id) == null)
                new_items.push(items[i]);
        }

        /* New items go at the beginnning of the array to
         * preserve ordering (RSS feeds usually have newer
         * items first) */
        this.items = new_items.concat(this.items);

        global.log('Retrieved ' + new_items.length + ' new items for ' + this.url);
        return new_items.length;
    },

    _get_item_by_id: function(id) {
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i].id == id)
                return this.items[i];
        }
        return null;
    },

    prune_items: function() {
        this.items = this.items.slice(0, MAX_FEED_ITEMS);
    },
};

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
