/*
 * Cinnamon RSS feed reader applet
 *
 * Author: jonbrett.dev@gmail.com
 * Date: 2013
 *
 * Cinnamon RSS feed reader applet is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * Cinnamon RSS feed reader applet is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General
 * Public License for more details.
 * You should have received a copy of the GNU General Public License along
 * with Cinnamon RSS feed reader applet.  If not, see
 * <http://www.gnu.org/licenses/>.
 */

const UUID = "feeds@jonbrettdev.wordpress.com"

imports.searchPath.push( imports.ui.appletManager.appletMeta[UUID].path );

const Lang = imports.lang;
const Applet = imports.ui.applet;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext.domain('cinnamon-applets');
const _ = Gettext.gettext;
const FeedReader = imports.feedreader;

function FeedApplet(orientation) {
    this._init(orientation);
}

FeedApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(orientation) {
        Applet.IconApplet.prototype._init.call(this, orientation);

        try {
            this.set_applet_icon_name("news-feed");
            this.set_applet_tooltip(_("Feed reader"));
        } catch (e) {
            global.logError(e);
        }
        this.reader = new FeedReader.FeedReader('http://segfault.linuxmint.com/feed/');

        this.reader.get();
    },

    on_applet_clicked: function(event) {
        GLib.spawn_command_line_async('xdg-open https://jonbrettdev.wordpress.com');
    }
};

function main(metadata, orientation) {
    return new FeedApplet(orientation);
}
