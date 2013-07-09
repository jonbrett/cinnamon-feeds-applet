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

const Applet = imports.ui.applet;
const FeedReader = imports.feedreader;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Util = imports.misc.util;
const _ = Gettext.gettext;

/* Menu item for displaying an feed item */
function FeedMenuItem() {
    this._init.apply(this, arguments);
}

FeedMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (label, url, read, id, reader, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.reader = reader;
        this.url = url;
        this.read = read;
        this.id = id;
        this.reader = reader;
        this.addActor(new St.Label({ text: label }));
    },

    read_item: function() {
        this.reader.mark_item_read(this.id);
        Util.spawnCommandLine('xdg-open ' + this.url);
    },
};


function FeedApplet(metadata, orientation) {
    this._init(metadata, orientation);
}

FeedApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(metadata, orientation) {
        Applet.IconApplet.prototype._init.call(this, orientation);

        try {
            this.icon_path = metadata.path + '/icons/';
            this.set_applet_icon_path(this.icon_path + 'rss.svg');
            this.set_applet_tooltip(_("Feed reader"));

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this.reader = new FeedReader.FeedReader(
                    'http://segfault.linuxmint.com/feed/',
                    metadata.path + '/feeds',
                    5,
                    {
                        'onUpdate' : Lang.bind(this, this.on_update)
                    });

            this.build_menu();

            this.refresh();
            this.timeout = GLib.timeout_add_seconds(0, 60, Lang.bind(this, this.refresh));
        } catch (e) {
            global.logError(e);
        }
    },

    on_update: function() {
        this.build_menu();
    },

    build_menu: function() {

        this.menu.removeAll();

        var item = new PopupMenu.PopupMenuItem(this.reader.title);
        this.menu.addMenuItem(item);
        item = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(item);

        var unread_count = 0;

        for (var i = 0; i < this.reader.items.length; i++) {
            var item = new FeedMenuItem(
                    this.reader.items[i].title,
                    this.reader.items[i].link,
                    this.reader.items[i].read,
                    this.reader.items[i].id,
                    this.reader);
            item.connect("activate", function(actor, event) {
                actor.read_item();
            });
            this.menu.addMenuItem(item);

            if (!this.reader.items[i].read)
                unread_count++;
        }

        if (unread_count > 0) {
            this.set_applet_icon_path(this.icon_path + 'rss-highlight.svg');
            this.set_applet_tooltip(this.reader.title + ' [' + unread_count + ']');
        } else {
            this.set_applet_icon_path(this.icon_path + 'rss.svg');
            this.set_applet_tooltip(this.reader.title);
        }
    },

    refresh: function() {
        this.reader.get()
    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
    }
};

function main(metadata, orientation) {
    return new FeedApplet(metadata, orientation);
}
