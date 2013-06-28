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

const Soup = imports.gi.Soup;
const Lang = imports.lang;
const Gettext = imports.gettext.domain('cinnamon-applets');
const _ = Gettext.gettext;

function FeedReader(url) {
    this._init(url);
}

FeedReader.prototype = {

    _init: function(url) {

        this.url = url;

        /* Get namespace */
        try {
            this.rssns = new Namespace('http://www.rssboard.org/rss-specification');
        } catch (e) {
            throw "Failed to create RSS namespace: " + e;
        }

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

        var feed = message.response_body.data;

        global.log(feed);
    }
};

