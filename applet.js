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

const FEED_IMAGE_HEIGHT_MAX = 100;
const FEED_IMAGE_WIDTH_MAX = 200;
const TOOLTIP_WIDTH = 500.0;
const MIN_MENU_WIDTH = 400;

imports.searchPath.push( imports.ui.appletManager.appletMeta[UUID].path );

const Applet = imports.ui.applet;
const Cinnamon = imports.gi.Cinnamon;
const CinnamonVersion=imports.misc.config.PACKAGE_VERSION;
const FeedReader = imports.feedreader;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const _ = Gettext.gettext;

const Logger = imports.logger;

/*  Application hook */
function main(metadata, orientation, panel_height, instance_id) {
    return new FeedApplet(metadata, orientation, panel_height, instance_id);
}

/* constructor for applet */
function FeedApplet() {
    this._init.apply(this, arguments);
}

/* Applet */
FeedApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        // Initialize the settings early so we can use them
        this.init_settings();

        try {
            debug_logging = this.settings.getValue("enable-verbose-logging");

            // Initialize a debug logger
            this.logger = new Logger.Logger({
                uuid: UUID,
                verbose: debug_logging
            });

            this.logger.info("Logging set at " + ((debug_logging) ? "debug" : "info"));

            this.feeds = new Array();
            this.path = metadata.path;
            this.icon_path = metadata.path + '/icons/';
            Gtk.IconTheme.get_default().append_search_path(this.icon_path);
            this.set_applet_icon_symbolic_name("rss");
            this.set_applet_tooltip(_("Feed reader"));

            this.logger.debug("Creating menus");
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this.feed_file_error = false;
            this.url_changed();
        } catch (e) {
            // Just in-case the logger is the issue.
            if(this.logger != undefined){
                this.logger.error(e);
            }
            global.logError(e);
        }

        this.build_context_menu();
        this.update();
    },

    init_settings: function(instance_id) {
        this.settings = new Settings.AppletSettings(this, UUID, this.instance_id);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "refresh_interval",
                "refresh_interval_mins",
                this.on_settings_changed,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "show_read_items",
                "show_read_items",
                this.on_settings_changed,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "max_items",
                "max_items",
                this.update_params,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "show_feed_image",
                "show_feed_image",
                this.on_settings_changed,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "notifications_enabled",
                "notifications_enabled",
                this.on_settings_changed,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "enable-verbose-logging",
                "enable_verbose_logging",
                this.on_settings_changed,
                null);

        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                "url",
                "url_list_str",
                this.url_changed,
                null);
    },

    build_context_menu: function() {
        this.logger.debug("build_context_menu");
        var s = new Applet.MenuItem(
                _("Mark all read"),
                "object-select-symbolic",
                Lang.bind(this, function() {
                    for (var i = 0; i < this.feeds.length; i++)
                        this.feeds[i].mark_all_items_read();
                }));
        this._applet_context_menu.addMenuItem(s);

        var s = new Applet.MenuItem(
                _("Reload"),
                "view-refresh-symbolic",
                Lang.bind(this, function() {
                    this.logger.debug("view-refresh-symbolic calling refresh");
                    this.refresh_tick();
                }));
        this._applet_context_menu.addMenuItem(s);

        var s = new Applet.MenuItem(
                _("Manage feeds"),
                "document-properties-symbolic",
                Lang.bind(this, function() {
                    this.manage_feeds();
                }));
        this._applet_context_menu.addMenuItem(s);

        /* Include setting menu item in Cinnamon < 2.0.0 */
        this.logger.info("Cinnamon Version: " + CinnamonVersion);
        if (parseInt(CinnamonVersion) == 1) {
            s = new Applet.MenuItem(
                    _("Settings"),
                    "emblem-system-symbolic",
                    Lang.bind(this, function() {
                        Util.spawnCommandLine('cinnamon-settings applets ' + UUID);
                    }));
            this._applet_context_menu.addMenuItem(s);
        }
    },

    /* Converts a settings string into an array of objects, each containing a
     * url and title property */
    parse_feed_urls: function(str) {
        this.logger.debug("parse_feed_urls");
        let lines = str.split("\n");
        let url_list = new Array();

        for (var i in lines) {
            this.logger.debug("Parsing: " + lines[i]);
            try{
                /* Strip redundant (leading,trailing,multiple) whitespace */
                lines[i] = lines[i].trim().replace(/\s+/g, " ");

                /* Skip empty lines and lines starting with '#' */
                if (lines[i].length == 0 || lines[i].substring(0, 1) == "#")
                    continue;

                /* URL is the first word on the line, the rest of the line is an
                 * optional title */
                url_list.push({
                    url: lines[i].split(" ")[0],
                    title: lines[i].split(" ").slice(1).join(" ")
                });
            }
            catch(e){
                if(this.logger != undefined)
                    this.logger.error(e);
                global.log(e.toString());
            }
        }

        return url_list;
    },

    url_changed: function() {
        this.logger.debug("url_changed");
        let url_list = this.parse_feed_urls(this.url_list_str);
        this.on_feeds_changed(url_list);
    },

    // called when feeds have been added or removed
    on_feeds_changed: function(url_list) {
        this.logger.debug("on_feeds_changed (url_list)");
        this.feeds = new Array();

        this.menu.removeAll();

        // Feed Level Menu Items Added Here (each Feed includes posts).

        for(var i = 0; i < url_list.length; i++) {
            this.feeds[i] = new FeedDisplayMenuItem(url_list[i].url, this,
                    {
                        logger: this.logger,
                        max_items: this.max_items,
                        show_read_items: this.show_read_items,
                        show_feed_image: this.show_feed_image,
                        custom_title: url_list[i].title
                    });
            this.menu.addMenuItem(this.feeds[i]);
        }

        if (this.feeds.length > 0)
            this.feed_to_show = this.feeds[0];

        this.logger.debug("on_feeds_changed calling refresh");
        this.refresh_tick();
    },

    /* Called by Feed Display items to notify of changes to
     * feed info (e.g. unread count, title).  Updates the
     * applet icon and tooltip */
    update: function() {
        this.logger.debug("update");
        let unread_count = 0;
        let tooltip = "";

        for (var i = 0; i < this.feeds.length; i++) {
            unread_count += this.feeds[i].get_unread_count();
            if (i != 0)
                tooltip += "\n";
            tooltip += this.feeds[i].get_title() + "[" + this.feeds[i].get_unread_count() + "]";
        }

        if (unread_count > 0)
            this.set_applet_icon_symbolic_name("feed-new");
        else
            this.set_applet_icon_symbolic_name("feed");

        this.set_applet_tooltip(tooltip);
    },

    on_settings_changed: function() {
        this.logger.debug("on_settings_changed");
        for (var i = 0; i < this.feeds.length; i++) {
            this.feeds[i].on_settings_changed({
                    max_items: this.max_items,
                    show_read_items: this.show_read_items,
                    show_feed_image: this.show_feed_image
            });
            this.feeds[i].update();
        }

        logging_level = this.settings.getValue("enable-verbose-logging");
        // notify only when the logging level has changed.
        if(this.logger.verbose != logging_level){
            this.logger.info("Logging changed to " + ((this.logger.verbose) ? "debug" : "info"));
            this.logger.verbose = logging_level;
        }

        this.refresh_tick();
    },
    /* renamed to refresh_tick to prevent this from being called repeatedly by somewhere */
    refresh_tick: function() {
        this.logger.debug("Removing previous timer: " + this.timer_id);
        /* Remove any previous timeout */
        if (this.timer_id) {
            Mainloop.source_remove(this.timer_id);
            this.timer_id = 0;
        }
        this.logger.debug("Updating all feed display items");
        /* Update all feed display items */
        for (var i = 0; i < this.feeds.length; i++) {
            this.feeds[i].refresh();
        }

        /* Convert refresh interval from mins -> ms */
        this.timeout = this.refresh_interval_mins * 60 * 1000;

        this.logger.debug("Setting next timeout to: " + this.timeout + " ms");
        /* Set the next timeout */
        this.timer_id = Mainloop.timeout_add(this.timeout,
                Lang.bind(this, this.refresh_tick));

        this.logger.debug("timer_id: " + this.timer_id);
    },

    on_applet_clicked: function(event) {
        this.logger.debug("on_applet_clicked");
        this.menu.toggle();
        this.toggle_submenus(null);
    },

    new_item_notification: function(feedtitle, itemtitle) {
        if(this.logger == undefined)
            global.log("Undefined Logger p2")
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

    toggle_submenus: function(feed_to_show) {
        this.logger.debug("toggle_submenu");

        if (feed_to_show != null)
            this.feed_to_show = feed_to_show;

        for (i in this.feeds) {
            if (this.feed_to_show == this.feeds[i]) {
                this.feeds[i].menu.open(true);
            } else {
                this.feeds[i].menu.close(true);
            }
        }
    },

    _read_manage_app_stdout: function() {
        this.logger.debug("_read_manage_app_stdout");
        /* Asynchronously wait for stdout of management app */
        this._manage_data_stdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
            if (stream.fill_finish(result) == 0) {
                try {
                    let read = stream.peek_buffer().toString();
                    if (read.length > 0) {
                        this.url_list_str = read;
                        this.url_changed();
                    }
                } catch(e) {
                    this.logger.error(e);
                    global.log(e.toString());
                }
                this._manage_stdout.close(null)
            } else {
                /* Not enough space in stream buffer for all the output#
                 * Double it and retry */
                stream.set_buffer_size(2 * stream.get_buffer_size());
                this._read_manage_app_stdout();
            }
        }));
    },

    /* Feed manager functions */
    manage_feeds: function() {
        this.logger.debug("manage_feeds");
        try {


            let argv = [this.path + "/manage_feeds.py"];
            let [exit, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                    null,
                    argv,
                    null,
                    GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null);

            /* Store stdin, stdout but close stderr */
            this._manage_stdout = new Gio.UnixInputStream({fd: stdout, close_fd: true});
            this._manage_data_stdout = new Gio.DataInputStream({
                base_stream: this._manage_stdout
            });
            this._manage_stdin = new Gio.UnixOutputStream({fd: stdin, close_fd: true});
            this._manage_data_stdin = new Gio.DataOutputStream({
                base_stream: this._manage_stdin
            });
            new Gio.UnixInputStream({fd: stderr, close_fd: true}).close(null);

            /* Write current feeds list to management app stdin */
            this._manage_data_stdin.put_string(this.url_list_str, null);
            this._manage_stdin.close(null);
        }
        catch (e) {
            if(this.logger != undefined){
                this.logger.error(e);
            }
            global.logError(e);
        }
        /* Get output from management app */
        this._read_manage_app_stdout();

    },
};

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
                    'onNewItem' : Lang.bind(this.owner, this.owner.new_item_notification)
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
};

