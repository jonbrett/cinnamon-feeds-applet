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
const _ = Gettext.gettext;

function FeedReader(url, path, max_item, callbacks) {
    this._init(url, path, max_item, callbacks);
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

        var feed = new XML(message.response_body.data.replace(
                /^<\?xml\s+.*\?>/g, ''));

        /* Process RSS to update channel data */
        this.title = String(feed..channel.title);
        this.description = String(feed..channel.description);
        this.link = String(feed..channel.link);

        var rss_item = feed..channel.item;
        var new_items = new Array();

        for (var i = 0; i < rss_item.length(); i++) {
            var new_item = {
                'title': String(rss_item[i].title),
                'link': String(rss_item[i].link),
                'description': String(rss_item[i].description),
                'id': String(rss_item[i].guid),
                'read': false
            };

            /* guid is optional in RSS spec, so use link as identifier if it's
             * not present */
            if (new_item.id == '')
                new_item.id = new_item.link;

            new_items.push(new_item);
        }

        /* We are only interested in new items that we haven't seen before */
        if (this._add_items(new_items) > 0) {
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
            var data = {
                "title": this.title,
                "link": this.link,
                "description": this.description,
                "items": this.items
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
            /* File doesn't exist yet. This is fine */
            global.log("No feed backing file (this is fine for a new feed)");
            return;
        }

        try {
            var content = Cinnamon.get_file_contents_utf8_sync(
                    this.path + '/' + sanitize_url(this.url));
            var data = JSON.parse(unescape(content));

            if (typeof data == "object") {
                if (data.title != undefined)
                    this.title = data.title;
                else
                    this.title = _("Loading feed");

                if (data.link != undefined)
                    this.link = data.link;

                if (data.description != undefined)
                    this.description = data.description;

                if (data.items != undefined)
                    this.items = data.items
                else
                    this.items = new Array();
            } else {
                global.logError('Invalid data loaded for ' + this.url);
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

};

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
