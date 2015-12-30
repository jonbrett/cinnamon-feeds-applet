/*
 * Cinnamon RSS feed reader applet Custom Menu Items
 *
 * Author: jonbrett.dev@gmail.com
 * Date: 2015
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
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu;
const FeedReader = imports.feedreader;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Tooltips = imports.ui.tooltips;

/* Menu item for displaying a simple message */
function LabelMenuItem() {
    this._init.apply(this, arguments);
}

LabelMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (text, tooltip_text, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.addActor(new St.Label());

        let label = new St.Label({ text: text });
        this.addActor(label);

        if (this.tooltip_text != '')
            this.tooltip = new Tooltips.Tooltip(this.actor, tooltip_text);

        /* Ensure tooltip is destroyed when this menu item is destroyed */
        this.connect('destroy', Lang.bind(this, function() {
            if (this.tooltip != undefined)
                this.tooltip.destroy();
        }));
    },
};

/* Menu item for displaying an feed item */
function FeedMenuItem() {
    this._init.apply(this, arguments);
}

FeedMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (item, width, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this.item = item;
        if (this.item.read)
            this._icon_name = 'feed-symbolic';
        else
            this._icon_name = 'feed-new-symbolic';

        let table = new St.Table({homogeneous: false, reactive: true });
        table.set_width(width);

        this.icon = new St.Icon({icon_name: this._icon_name,
                icon_type: St.IconType.SYMBOLIC,
                style_class: 'popup-menu-icon' });
        table.add(this.icon, {row: 0, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START});

        this.label = new St.Label({text: FeedReader.html2text(item.title)});
        this.label.set_margin_left(6.0);
        table.add(this.label, {row: 0, col: 1, col_span: 1, x_align: St.Align.START});

        this.addActor(table, {expand: true, span: 1, align: St.Align.START});

        this.connect('activate', Lang.bind(this, function() {
                    this.read_item();
                }));

        this.tooltip = new Tooltips.Tooltip(this.actor,
                FeedReader.html2text(item.title) + '\n\n' +
                FeedReader.html2text(item.description));

        /* Some hacking of the underlying tooltip ClutterText to set wrapping,
         * format, etc */
        try {
            this.tooltip._tooltip.style_class = 'feedreader-item-tooltip';
            this.tooltip._tooltip.get_clutter_text().set_width(TOOLTIP_WIDTH);
            this.tooltip._tooltip.get_clutter_text().set_line_alignment(0);
            this.tooltip._tooltip.get_clutter_text().set_line_wrap(true);
            this.tooltip._tooltip.get_clutter_text().set_markup(
                    '<span weight="bold">' +
                    FeedReader.html2pango(item.title) +
                    '</span>\n\n' +
                    FeedReader.html2pango(item.description));
        } catch (e) {
            /* If we couldn't tweak the tooltip format this is likely because
             * the underlying implementation has changed. Don't issue any
             * failure here */
        }

        /* Ensure tooltip is destroyed when this menu item is destroyed */
        this.connect('destroy', Lang.bind(this, function() {
            this.tooltip.destroy();
        }));
    },

    read_item: function() {
        this.item.open();

        /* Update icon */
        this._icon_name = 'feed-symbolic';
        this.icon.set_icon_name(this._icon_name);

        this.emit('item-read');
    },
};

/* Menu item for displaying the feed title*/
function FeedDisplayMenuItem() {
    this._init.apply(this, arguments);
}

FeedDisplayMenuItem.prototype = {
    __proto__: PopupMenu.PopupSubMenuMenuItem.prototype,

    _init: function (url, owner, params) {
        PopupMenu.PopupSubMenuMenuItem.prototype._init.call(this, _("Loading feed"));
        this.logger = params.logger;
        this.owner = owner;
        this.max_items = params.max_items;
        this.show_feed_image = params.show_feed_image;
        this.show_read_items = params.show_read_items;
        this.unread_count = 0;
        this.custom_title = params.custom_title;

        this.logger.debug("Loading FeedReader url: " + url);
        /* Create reader */
        this.reader = new FeedReader.FeedReader(
                this.logger,
                url,
                '~/.cinnamon/' + UUID + '/' + owner.instance_id,
                {
                    'onUpdate' : Lang.bind(this, this.update),
                    'onError' : Lang.bind(this, this.error),
                    'onNewItem' : Lang.bind(this.owner, this.new_item_notification)
                }
                );

        /* Create initial layout for menu title We wrap the main titlebox in a
         * container in order to avoid excessive spacing caused by the
         * mainbox vertical layout */
        this.mainbox = new St.BoxLayout({
            style_class: 'feedreader-title',
            vertical: true
        });
        this.mainbox.add(new St.Label({text:_("_Loading")}));

        this.statusbox = new St.BoxLayout({
            style_class: 'feedreader-status',
            vertical: true
        });

        /* Remove/re-add PopupSubMenuMenuItem actors to insert our own actors
         * in place of the the regular label. We use a table to increase
         * control of the layout */
        this.removeActor(this.label);
        this.removeActor(this._triangle);
        this.table = new St.Table({homogeneous: false,
                                    reactive: true });

        this.table.add(this.statusbox,
                {row: 0, col: 0, col_span: 1, x_expand: false, x_align: St.Align.START, y_align: St.Align.MIDDLE});
        this.table.add(this.mainbox,
                {row: 0, col: 1, col_span: 1, x_expand: true, x_align: St.Align.START});

        this.addActor(this.table, {expand: true, align: St.Align.START});
        this.addActor(this._triangle, {expand: false, align: St.Align.END});

        this.menu.connect('open-state-changed', Lang.bind(this, this.on_open_state_changed));

        Mainloop.idle_add(Lang.bind(this, this.update));
    },

    on_settings_changed: function(params) {
        this.max_items = params.max_items;
        this.show_feed_image = params.show_feed_image;
        this.show_read_items = params.show_read_items;

        this.update();
    },

    refresh: function() {
        this.logger.debug("FeedDisplayMenuItem.refresh");
        this.reader.get();
    },

    get_title: function() {
        // returns the title or custom title, if defined
        return this.custom_title || this.reader.title;
    },

    get_unread_count: function() {
        return this.unread_count;
    },

    /* Rebuild the feed title, status, items from the feed reader */
    update: function() {
        this.logger.debug("FeedDisplayMenuItem.update");

        /* Clear existing actors */
        this.statusbox.destroy_all_children();
        this.mainbox.destroy_all_children();
        this.menu.removeAll();

        /* Use feed image where available for title */
        if (this.reader.image.path != undefined &&
                this.show_feed_image == true) {
            try {
                let image = St.TextureCache.get_default().load_uri_async(
                        GLib.filename_to_uri(this.reader.image.path, null),
                        FEED_IMAGE_WIDTH_MAX,
                        FEED_IMAGE_HEIGHT_MAX);

                let imagebox = new St.BoxLayout({
                    style_class: 'feedreader-title-image',
                });
                imagebox.add(image);

                this.mainbox.add(imagebox, { x_align: St.Align.START, x_fill: false });
            } catch (e) {
                if(this.logger != undefined)
                    this.logger.error(e);
                global.logError("Failed to load feed icon: " + this.reader.image.path + ' : ' + e);
            }
        }

        /* Add buttons */
        let buttonbox = new St.BoxLayout({
            style_class: 'feedreader-title-buttons'
        });

        // use custom title if defined
        let used_title = this.custom_title || this.reader.title;

        let _title = new St.Label({ text: used_title,
            style_class: 'feedreader-title-label'
        });
        buttonbox.add(_title);

        let button = new St.Button({ reactive: true });
        let icon = new St.Icon({
            icon_name: "web-browser-symbolic",
            style_class: 'popup-menu-icon',
        });
        button.set_child(icon);
        button.url = this.url;
        button.connect('clicked', Lang.bind(this, function(button, event) {
            if(this.logger == undefined)
                global.log("logger undefined p1");
            this.logger.debug("FeedDisplayMenuItem.xdg-open Feed: " + this.reader.link);
            Util.spawnCommandLine('xdg-open ' + this.reader.link);
            this.owner.menu.close();
        }));

        let tooltip = new Tooltips.Tooltip(button, this.reader.link);
        buttonbox.add(button);

        button = new St.Button({ reactive: true });
        icon = new St.Icon({ icon_name: "object-select-symbolic",
            style_class: 'popup-menu-icon'
        });
        button.set_child(icon);
        button.connect('clicked', Lang.bind(this, function(button, event) {
            this.owner.menu.close();
            this.mark_all_items_read();
        }));
        let tooltip = new Tooltips.Tooltip(button, _("Mark all read"));
        buttonbox.add(button);

        this.mainbox.add(buttonbox);

        /* Add feed items to submenu */
        let width = this.table.get_width();
        if (width < MIN_MENU_WIDTH) {
            this.table.set_width(MIN_MENU_WIDTH);
            width = MIN_MENU_WIDTH;
        }

        this.logger.debug("FeedDisplayMenuItem.Finding unread items");
        let menu_items = 0;
        this.unread_count = 0;
        for (var i = 0; i < this.reader.items.length && menu_items < this.max_items; i++) {
            if (this.reader.items[i].read && !this.show_read_items)
                continue;

            if (!this.reader.items[i].read)
                this.unread_count++;

            let item = new FeedMenuItem(this.reader.items[i], width);
            item.connect('item-read', Lang.bind(this, function () { this.update(); }));
            this.logger.debug("Adding item: " + item);
            this.menu.addMenuItem(item);

            menu_items++;
        }

        /* Append unread_count to title */
        if (this.unread_count > 0)
            _title.set_text(_title.get_text() + " [" + this.unread_count + "]");

        this.owner.update();
    },

    error: function(reader, message, full_message) {
        this.statusbox.destroy_all_children();
        this.menu.removeAll();

        this.menu.addMenuItem(new LabelMenuItem(
                    message, full_message));
    },

    mark_all_items_read: function() {
            this.reader.mark_all_items_read();
            this.update();
    },

    on_open_state_changed: function(menu, open) {
        if (open)
            this.owner.toggle_submenus(this);
        else
            this.owner.toggle_submenus(null);
    },
    new_item_notification: function(feedtitle, itemtitle) {
        this.logger.debug("new_item_notification");
        /* Displays a popup notification using notify-send */

        // if notifications are disabled don't do anything
        if(!this.notifications_enabled) {
            this.logger.debug("Notifications Disabled");
            return;
        }

        let iconpath = this.path + "/icon.png";

        let command = 'notify-send -i ' + iconpath + ' "' + feedtitle + '" "' + itemtitle + '"';

        this.logger.debug("Executing Command: " + command);
        GLib.spawn_command_line_async(command);
    },
};