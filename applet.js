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
const Clutter = imports.gi.Clutter;
const Logger = imports.log_util;

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
            //tooltip += this.feeds[i].get_title() + "[" + this.feeds[i].get_unread_count() + "]";
            tooltip += this.feeds[i].get_title();
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
        this.logger.debug("toggle_submenus");

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

    on_applet_removed_from_panel: function() {
        /* Clean up the timer so if the feed applet is removed it stops firing requests.  */
        this.logger.debug("Removed from panel event");
        if (this.timer_id) {
            this.logger.debug("Removing Timer with ID: " + this.timer_id);
            Mainloop.source_remove(this.timer_id);
            this.timer_id = 0;
        }
    }
};

/* Menu item for displaying the feed title*/
function FeedDisplayMenuItem() {
    this._init.apply(this, arguments);
}

FeedDisplayMenuItem.prototype = {
    __proto__: PopupMenu.PopupSubMenuMenuItem.prototype,

    _init: function (url, owner, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, {hover: false});
        this.show_action_items = false;

        this._title = new St.Label({ text: "loading",
            style_class: 'feedreader-title-label'
        });

        this.addActor(this._title, {expand: true, align: St.Align.START});

        this._triangleBin = new St.Bin({ x_align: St.Align.END });
        this.addActor(this._triangleBin, { expand: true,
                                           span: -1,
                                           align: St.Align.END });

        this._triangle = new St.Icon({ style_class: 'popup-menu-arrow',
                              icon_name: 'pan-end',
                              icon_type: St.IconType.SYMBOLIC,
                              y_expand: true,
                              y_align: Clutter.ActorAlign.CENTER,
                              important: true });

        this._triangle.pivot_point = new Clutter.Point({ x: 0.5, y: 0.6 });
        this._triangleBin.child = this._triangle;

        this.menu = new PopupMenu.PopupSubMenu(this.actor, this._triangle);
        this.menu.actor.set_style_class_name('menu_context_menu');

        this.logger = params.logger;
        this.owner = owner;
        this.max_items = params.max_items;
        this.show_feed_image = params.show_feed_image;
        this.show_read_items = params.show_read_items;
        this.unread_count = 0;
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

        if(!params.custom_title)
            this.rssTitle = this.reader.title;
        else
            this.rssTitle = params.custom_title;

        this._title.set_text(this.rssTitle);

        Mainloop.idle_add(Lang.bind(this, this.update));
    },
    get_title: function() {
        let title =  this.custom_title || this.reader.title;
        title += " [" + this.unread_count + "]";
        return title;
    },
    get_unread_count: function() {
        return this.unread_count;
    },
    error: function(reader, message, full_message) {
        this.menu.removeAll();

        this.menu.addMenuItem(new LabelMenuItem(
                    message, full_message));
    },
    update: function() {
        this.logger.debug("FeedDisplayMenuItem.update");
        this.menu.removeAll();

        this.logger.debug("Finding unread items out of: " + this.reader.items.length + "total items");
        let menu_items = 0;
        this.unread_count = 0;
        this.logger.debug(this.max_items);
        let width = MIN_MENU_WIDTH;
        for (var i = 0; i < this.reader.items.length && menu_items < this.max_items; i++) {
            if (this.reader.items[i].read && !this.show_read_items)
                continue;

            if (!this.reader.items[i].read)
                this.unread_count++;

            let item = new FeedMenuItem(this.reader.items[i], width, this.logger);
            item.connect('item-read', Lang.bind(this, function () { this.update(); }));
            this.logger.debug("Adding item: " + item);
            this.menu.addMenuItem(item);

            menu_items++;
        }

        this.logger.debug("Link: " + this.reader.url);
        let tooltip = new Tooltips.Tooltip(this.actor, this.reader.url);

        /* Append unread_count to title */
        if (this.unread_count > 0)
            this._title.set_text(this.get_title());

        this.owner.update();
    },
    refresh: function() {
        this.logger.debug("FeedDisplayMenuItem.refresh");
        this.reader.get();
    },

    _onButtonReleaseEvent: function (actor, event) {
        this.logger.debug("Button Pressed Event: " + event.get_button());
        if(event.get_button() == 3){
            this.toggleMenu();
            return false;
        }

        // Left click, toggle the menu if its not already open.
        if (this.menu.open)
            this.owner.toggle_submenus(this);
        else
            this.owner.toggle_submenus(null);

        return false;
    },
    toggleMenu: function() {
        // Try 1.. Add new submenu items at the top for "mark all read"
        this.logger.debug("toggle sub menu options.");
        this.logger.debug("Current Number of MenuItems: " + this.menu.length);
        if(this.show_action_items){
            // Remove the items.
            let children = this.menu.box.get_children();

            for(let i = 0; i < 1 && i < children.length; i++)
                this.menu.box.remove_actor(children[i]);
            this.show_action_items = false;
        } else {

            // Add a new item to the top of the list.
            let menuitem;

            menuitem = new ApplicationContextMenuItem(this, _("Mark All Posts Read"), "mark_all_read");
            this.menu.addMenuItem(menuitem, 0);
            this.show_action_items = true;
        }
    },
};


/* Menu item for displaying an feed item */
function FeedMenuItem() {
    this._init.apply(this, arguments);
}

FeedMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (item, width, logger, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);
        this.logger = logger;

        this.item = item;
        if (this.item.read){
                this._icon_name = 'feed-symbolic';
                this.icon_type = St.IconType.SYMBOLIC;
            }
        else
            {
                this._icon_name = 'feed-new-symbolic';
                this.icon_type = St.IconType.FULLCOLOR;
        }

        this.icon = new St.Icon({icon_name: this._icon_name,
                icon_type: this.icon_type,
                style_class: 'popup-menu-icon' });

        this.label = new St.Label({text: FeedReader.html2text(item.title)});

        this.addActor(this.icon, {span: 0});
        this.addActor(this.label, {expand: true, span: 1, align: St.Align.START});

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
            this.logger.debug("Error Tweaking Tooltip: " + e);
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

function ApplicationContextMenuItem(appButton, label, action){
    this._init(appButton, label, action);
}

ApplicationContextMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(appButton, label, action){
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, {focusOnHover: false});

        this._appButton = appButton;
        this._action = action;
        this.label = new St.Label({ text: label });
        this.addActor(this.label);
    },

    activate: function(event){
        switch(this._action){
            case "mark_all_read":
                this.logger.debug("Marking all items read");
                break;
            case "delete_all_items":
                this.logger.debug("Marking all items 'deleted'");
                break;
        }
    }
};