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
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const _ = Gettext.gettext;

/* Menu item for displaying an feed item */
function FeedMenuItem() {
    this._init.apply(this, arguments);
}

FeedMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (label, url, read, id, reader, icon_path, on_update, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this._on_update = on_update;
        this.reader = reader;
        this.url = url;
        this.id = id;

        if (read)
            var icon_filename = icon_path +  'rss-deactivated.svg';
        else
            var icon_filename = icon_path + 'rss-highlight.svg';

        var fi = undefined;
        try {
            fi = new Gio.FileIcon({ file: Gio.file_new_for_path(icon_filename) });
        } catch (e) {
            global.logError('Failed to load icon file ' + icon_filename + ' : ' + e);
        }

        if (fi != undefined)
            this.addActor(new St.Icon({ gicon: fi, icon_size: 16 }));

        this.addActor(new St.Label({ text: label }));
    },

    refresh: function() {
        if (this._icon != undefined)
            this.removeActor(this._icon);
        if (this._label != undefined)
            this.removeActor(this._label);

        if (this.read)
            this._icon= new St.Icon({ gicon: this._read_icon, icon_size: 16 });
        else
            this._icon= new St.Icon({ gicon: this._unread_icon, icon_size: 16 });

        this._label = new St.Label({ text: this.label });

        this.addActor(this._icon);
        this.addActor(this._label);
    },

    read_item: function() {
        Util.spawnCommandLine('xdg-open ' + this.url);
        this.reader.mark_item_read(this.id);
        this._on_update();
    },
};

function FeedApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

FeedApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        try {
            this.path = metadata.path;
            this.icon_path = metadata.path + '/icons/';
            this.set_applet_icon_path(this.icon_path + 'rss.svg');
            this.set_applet_tooltip(_("Feed reader"));

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

        } catch (e) {
            global.logError(e);
        }

        this.init_settings();

        this.timeout = GLib.timeout_add_seconds(0, 60, Lang.bind(this, this.refresh));
    },

    init_settings: function(instance_id) {
        this.settings = new Settings.AppletSettings(this, UUID, this.instance_id);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "url", "url", this.url_changed, null);
        this.url_changed();

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "max_items", "max_items", this.build_menu, null);
        this.build_menu();
    },

    url_changed: function() {
        this.reader = new FeedReader.FeedReader(
                this.url,
                this.path + '/feeds',
                5,
                {
                    'onUpdate' : Lang.bind(this, this.on_update)
                });
        this.build_menu();
        this.refresh();
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

        for (var i = 0; i < Math.min(this.reader.items.length, this.max_items);
                i++) {
            var item = new FeedMenuItem(
                    this.reader.items[i].title,
                    this.reader.items[i].link,
                    this.reader.items[i].read,
                    this.reader.items[i].id,
                    this.reader,
                    this.icon_path,
                    Lang.bind(this, this.on_update)
                    );
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
        if (this.reader != undefined)
            this.reader.get()
    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new FeedApplet(metadata, orientation, panel_height, instance_id);
}
