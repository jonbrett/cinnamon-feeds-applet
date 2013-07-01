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
                /^<\?xml\s+version\s*=\s*(["'])[^\1]+\1[^?]*\?>/, ""));

        /* Process RSS to update channel data */
        this.title = String(feed..channel.title);
        this.description = String(feed..channel.description);
        this.link = String(feed..channel.link);

        var rss_item = feed..channel.item;
        this.items = new Array();

        for (var i = 0; i < Math.min(rss_item.length(), this.max_item); i++) {
            var item = rss_item[i];

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

            this.items.push(new_item);
        }

        global.log('Read ' + this.items.length + '/' + rss_item.length() +
                ' items from ' + this.url);

        this.save_items();
        this.load_items();

        this.callbacks.onUpdate();
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
            fs.write(escape(JSON.stringify(this.items)), null);
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
                this.items = data;
                global.log(data);
            } else {
                global.logError('Invalid data loaded for ' + this.url);
            }
        } catch (e) {
            /* Invalid file contents */
            global.logError('Failed to read feed data file for ' + this.url + ':' + e);
        }
    }
};

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
