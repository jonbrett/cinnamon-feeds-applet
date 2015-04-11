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

const ByteArray = imports.byteArray;
const Cinnamon = imports.gi.Cinnamon;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Soup = imports.gi.Soup;
var ImportGXml;
try {
    ImportGXml = imports.gi.GXml;
} catch(e) {
    ImportGXml = null;
}
const GXml = ImportGXml;
const Util = imports.misc.util;
const _ = Gettext.gettext;
const Main = imports.ui.main;

/* Maximum number of "cached" feed items to keep for this feed.
 * Older items will be trimmed first */
const MAX_FEED_ITEMS = 100;
const UUID = "feeds@jonbrettdev.wordpress.com"
const AppletDir = imports.ui.appletManager.appletMeta[UUID].path;
const InterfacesDir = Gio.file_new_for_path(AppletDir);
const FeedReaderIface = loadInterfaceXml("FeedReaderIface.xml");
const WATCHER_INTERFACE = 'org.Cinnamon.FeedReader';
const WATCHER_OBJECT = '/org/Cinnamon/FeedReader';

/**
 * loads a xml file into an in-memory string
 */
function loadInterfaceXml(filename) {

    let file = InterfacesDir.get_child(filename);

    let [ result, contents ] = GLib.file_get_contents(file.get_path());

    if (result) {
        //HACK: The "" + trick is important as hell because file_get_contents returns
        // an object (WTF?) but Gio.makeProxyWrapper requires `typeof() == "string"`
        // Otherwise, it will try to check `instanceof XML` and fail miserably because there
        // is no `XML` on very recent SpiderMonkey releases (or, if SpiderMonkey is old enough,
        // will spit out a TypeError soon).
        return "<node>" + contents + "</node>";
    } else {
        throw new Error("AppIndicatorSupport: Could not load file: "+filename);
    }
};

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
        try {
            Util.spawnCommandLine('xdg-open ' + this.link);
        } catch (e) {
            global.logError(e);
        }
        this.mark_read();
        this.reader.save_items();
    },

    mark_read: function() {
        this.read = true;
    }
}

function FeedReader() {
    this._init.apply(this, arguments);
}

FeedReader.prototype = {

    _init: function(url, path, callbacks) {
        this.url = url;
        this.path = path;
        this.callbacks = callbacks;
        this.error = false;

        /* Feed data */
        this.title = "";
        this.description = "";
        this.link = "";
        this.items = new Array();
        this.read_list = new Array();
        this.image = {};

        /* Init HTTP session */
        try {
            this.session = new Soup.SessionAsync();
            Soup.Session.prototype.add_feature.call(this.session,
                    new Soup.ProxyResolverDefault());
        } catch (e) {
            throw "Failed to create HTTP session: " + e;
        }

        if(GXml == null)
            this._load_program();

        /* Load items */
        this.load_items();
    },

    _acquiredName: function() {
        this._everAcquiredName = true;
        global.log('Acquired name ' + WATCHER_INTERFACE);
    },

    _lostName: function() {
        if (this._everAcquiredName)
            global.log('Lost name ' + WATCHER_INTERFACE);
        else
            global.logWarning('Failed to acquire ' + WATCHER_INTERFACE);
    },

    SetJsonResult: function(id, data) {
        let returnValue = null;
        try {
            returnValue = JSON.parse(data);
            if (returnValue == undefined)
                returnValue = null;
        } catch (e) {
            returnValue = null;
        }
        if(returnValue != null)
            this._parse_json_feed(returnValue);
        Main.notify("Result " + id + " " + returnValue + " " + global.get_current_time());
    },

    _load_program: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(FeedReaderIface, this);
        this._dbusImpl.export(Gio.DBus.session, WATCHER_OBJECT);
        this._everAcquiredName = false;
        this._ownName = Gio.DBus.session.own_name(WATCHER_INTERFACE,
                                  Gio.BusNameOwnerFlags.NONE,
                                  Lang.bind(this, this._acquiredName),
                                  Lang.bind(this, this._lostName));
        let program_file = InterfacesDir.get_child("xmltojson.py");
        if(program_file.query_exists(null)) {
            this._setChmod(program_file.get_path(), '+x');
        }
    },

    _execute_program: function(id, url) {
        let program_file = InterfacesDir.get_child("xmltojson.py")
        if(program_file.query_exists(null)) {
            let command = program_file.get_path() + " \"" + id + "\" \"" + url + "\"";
            this._execCommand(command);
            Main.notify(" " + id + " " + url);
        }
    },

    _setChmod: function(path, permissions) {
        let command = "chmod " + permissions + " \"" + path + "\"";
        this._execCommand(command);
    },

    _execCommand: function(command) {
        try {
            let [success, argv] = GLib.shell_parse_argv(command);
            this._trySpawnAsync(argv);
            return true;
        } catch (e) {
            let title = _("Execution of '%s' failed:").format(command);
            Main.notifyError(title, e.message);
        }
        return false;
    },

    _trySpawnAsync: function(argv) {
        try {   
            GLib.spawn_async(null, argv, null,
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDOUT_TO_DEV_NULL  | GLib.SpawnFlags.STDERR_TO_DEV_NULL,
                null, null);
        } catch (err) {
            if (err.code == GLib.SpawnError.G_SPAWN_ERROR_NOENT) {
                err.message = _("Command not found.");
            } else {
                // The exception from gjs contains an error string like:
                //   Error invoking GLib.spawn_command_line_async: Failed to
                //   execute child process "foo" (No such file or directory)
                // We are only interested in the part in the parentheses. (And
                // we can't pattern match the text, since it gets localized.)
                err.message = err.message.replace(/.*\((.+)\)/, '$1');
            }
            throw err;
        }
    },

    get: function() {
        /* Reset error state */
        this.error = false;

        if(GXml != null) {
            let msg = Soup.Message.new('GET', this.url);
            this.session.queue_message(msg,
                    Lang.bind(this, this._on_get_response));
        } else {
            let id = "" + global.get_current_time();
            this._execute_program(id, this.url);
        }
    },

    get_child_element: function(element, name) {
        let list_elements = element.get_elements_by_tag_name(name)
        for (var i = 0; i < list_elements.length; i++) {
            var node = list_elements.item(i);
            if((node) && (name == node.tag_name))
                return node;
        }
        return null;
    },

    process_rss: function(feed) {
        /* Get channel data */
        let channel = feed.get_elements_by_tag_name('channel').item(0);
        this.title = String(this.get_child_element(channel, 'title').content);
        this.description = String(this.get_child_element(channel, 'description').content);
        this.link = String(this.get_child_element(channel, 'link').content);
        this.image.url = String(this.get_child_element(channel, 'url').content);
        this.image.width = String(this.get_child_element(channel, 'width').content);
        this.image.height = String(this.get_child_element(channel, 'height').content);
        /* Get item list */
        let feed_items = channel.get_elements_by_tag_name('item');
        let new_items = new Array();
        for (var i = 0; i < feed_items.length; i++) {
            /* guid is optional in RSS spec, so use link as
             * identifier if it's not present */
            let feed_item = feed_items.item(i);
            let id = String(this.get_child_element(feed_item, 'guid').content);
            if (id == '')
                id = String(this.get_child_element(feed_item, 'link').content);

            new_items.push(new FeedItem(
                    id,
                    String(this.get_child_element(feed_item, 'title').content),
                    String(this.get_child_element(feed_item, 'link').content),
                    String(this.get_child_element(feed_item, 'description').content),
                    false,
                    this));
        }
        return new_items;
    },

    process_atom: function(atomns) { 
        /* Get atomns data */
        this.title = String(this.get_child_element(atomns, 'title').content);
        this.description = String(this.get_child_element(atomns, 'subtitle').content);
        this.link = String(this.get_child_element(atomns, 'link').content);
        this.image.url = String(this.get_child_element(atomns, 'logo').content);

        /* Get items */
        let feed_items = atomns.get_elements_by_tag_name('entry');
        let new_items = new Array();
        for (var i = 0; i < feed_items.length; i++) {
            let feed_item = feed_items.item(i);
            new_items.push(new FeedItem(
                    String(this.get_child_element(feed_item, 'id').content),
                    String(this.get_child_element(feed_item, 'title').content),
                    String(this.get_child_element(feed_item, 'link').content),
                    String(this.get_child_element(feed_item, 'summary').content),
                    false,
                    this));
        }
        return new_items;
    },

    _on_get_response: function(session, message) {
        try {
            var feed = GXml.Document.from_string (message.response_body.data.replace(
                    /^<\?xml\s+.*\?>/g, '')).document_element;
            this._parse_gxml_feed(feed);
        } catch (e) {
            return this.on_error('Failed to parse feed XML', e.message);
        }
    },

    _parse_gxml_feed: function(feed) {
        /* Determine feed type and parse */
        if (feed.node_name == "rss") {
            var new_items = this.process_rss(feed);
        } else {
            if (feed.node_name == "feed") {
                var new_items = this.process_atom(feed);
            } else {
                return this.on_error("Unknown feed type", this.url);
            }
        }

        if (new_items.length < 1) {
            return this.on_error("Unable to read feed contents", this.url);
        }

        /* Fetch image */
        this._fetch_image();

        /* Is this item in the old list or a new item
         * For existing items, transfer "read" property
         * For new items, check against the loaded historic read list */
        var new_count = 0;
        var unread_items = [];
        for (var i = 0; i < new_items.length; i++) {
            let existing = this._get_item_by_id(new_items[i].id);
            if (existing != null) {
                new_items[i].read = existing.read
            } else {
                if (this._is_in_read_list(new_items[i].id)) {
                    new_items[i].read = true;
                } else {
                    unread_items.push(new_items[i]);
                }
                new_count++;
            }
        }

        /* Were there any new items? */
        if (new_count > 0) {
            global.log("Fetched " + new_count + " new items from " + this.url);
            this.items = new_items;
            this.callbacks.onUpdate();
            if(unread_items.length == 1) {
                this.callbacks.onNewItem(this.title, unread_items[0].title);
            } else if(unread_items.length > 1) {
                this.callbacks.onNewItem(this.title, unread_items.length + " unread items!");
            }
        }
        return 0;
    },

    _parse_json_feed: function(feed_string) {
        Main.notify("_parse_json_feed " + feed_string);
    },

    mark_all_items_read: function() {
        for (var i = 0; i < this.items.length; i++)
            this.items[i].mark_read();
        this.save_items();
    },

    save_items: function() {
        try {
            var dir = Gio.file_parse_name(this.path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            /* Write feed items read list to a file as JSON.
             * I found escaping the string helps to deal with special
             * characters, which could cause problems when parsing the file
             * later */
            var file = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url));
            var fs = file.replace(null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            let read_list = [];
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].read == true)
                    read_list.push({ "id" : this.items[i].id });
            }

            var data = {
                "title": this.title,
                "read_list": read_list,
            };

            let output = escape(JSON.stringify(data));
            let to_write = output.length;
            while (to_write > 0) {
                to_write -= fs.write(output , null);
            }
            fs.close(null);
        } catch (e) {
            global.logError('Failed to write feed file ' + e);
        }
    },

    load_items: function() {
        try {
            let path = Gio.file_parse_name(this.path + '/' + sanitize_url(this.url)).get_path();
            var content = Cinnamon.get_file_contents_utf8_sync(path);
        } catch (e) {
            /* This is fine for new feeds */
            return;
        }

        try {
            var data = JSON.parse(unescape(content));

            if (typeof data == "object") {
                /* Load feedreader data */
                if (data.title != undefined)
                    this.title = data.title;
                else
                    this.title = _("Loading feed");

                if (data.read_list != undefined)
                    this.read_list = data.read_list;
                else
                    this.read_list = new Array();
            } else {
                global.logError('Invalid data file for ' + this.url);
            }
        } catch (e) {
            /* Invalid file contents */
            global.logError('Failed to read feed data file for ' + this.url + ':' + e);
        }
    },

    _fetch_image: function() {
        if (this.image.url == undefined || this.image.url == '')
            return;

        /* Use local file if it already exists */
        let f = Gio.file_parse_name(this.path + '/' + sanitize_url(this.image.url));
        if (f.query_exists(null)) {
            this.image.path = f.get_path();
            return;
        }

        /* Request image url */
        let msg = Soup.Message.new('GET', this.image.url);
        this.session.queue_message(msg,
                Lang.bind(this, this._on_img_response));
    },

    _on_img_response: function(session, message) {
        if (message.status_code != 200) {
            global.logError('HTTP request for ' + this.url + ' returned ' + message.status_code);
            return;
        }

        try {
            var dir = Gio.file_parse_name(this.path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            let file = Gio.file_parse_name(this.path + '/' + sanitize_url(this.image.url));
            let fs = file.replace(null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            var to_write = message.response_body.length;
            while (to_write > 0) {
                to_write -= fs.write(message.response_body.get_chunk(message.response_body.length - to_write).get_data(),
                        null, to_write);
            }
            fs.close(null);

            this.image.path = file.get_path();
            this.callbacks.onUpdate();
        } catch (e) {
            global.log("Error saving feed image for " + this.url + ": " + e);
            this.image.path = undefined;
        }
    },

    _get_item_by_id: function(id) {
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i].id == id)
                return this.items[i];
        }
        return null;
    },

    _is_in_read_list: function(id) {
        for (var i = 0; i < this.read_list.length; i++) {
            if (this.read_list[i].id == id)
                return true;
        }
        return false;
    },

    /* Fatal error handler
     *
     * Log error state and report to application
     */
    on_error: function(msg, details) {
        global.logError("Feedreader (" + this.url +"): " + msg);

        this.error = true;
        this.error_messsage = msg;
        this.error_details = details;

        if (this.callbacks.onError)
            this.callbacks.onError(this, msg, details);

        return 1;
    },
};

/* Convert html to plaintext */
function html2text(html) {
    return html.replace('<br/>', '\n').replace('</p>','\n').replace(/<\/h[0-9]>/g, '\n\n').replace(/<.*?>/g, '').replace('&nbsp;', ' ').replace('&quot;', '"').replace('&rdquo;', '"').replace('&ldquo;', '"').replace('&#8220;', '"').replace('&#8221;', '"').replace('&rsquo;', '\'').replace('&lsquo;', '\'').replace('&#8216;', '\'').replace('&#8217;', '\'').replace('&#8230;', '...');
}

/* Convert html to (basic) Gnome Pango markup */
function html2pango(html) {
    let ret = html;
    let esc_open = '-@~]';
    let esc_close= ']~@-';

    /* </p> <br/> --> newline */
    ret = ret.replace('<br/>', '\n').replace('</p>','\n');

    /* &nbsp; --> space */
    ret = ret.replace(/&nbsp;/g, ' ');

    /* Headings --> <b> + 2*newline */
    ret = ret.replace(/<h[0-9]>/g, esc_open+'span weight="bold"'+esc_close);
    ret = ret.replace(/<\/h[0-9]>\s*/g, esc_open+'/span'+esc_close+'\n\n');

    /* <strong> -> <b> */
    ret = ret.replace('<strong>', esc_open+'b'+esc_close);
    ret = ret.replace('</strong>', esc_open+'/b'+esc_close);

    /* <i> -> <i> */
    ret = ret.replace('<i>', esc_open+'i'+esc_close);
    ret = ret.replace('</i>', esc_open+'/i'+esc_close);

    /* Strip remaining tags */
    ret = ret.replace(/<.*?>/g, '');

    /* Replace escaped <, > with actual angle-brackets */
    let re1 = new RegExp(esc_open, 'g');
    let re2 = new RegExp(esc_close, 'g');
    ret = ret.replace(re1, '<').replace(re2, '>');

    return ret;
}

function sanitize_url(url) {
    return url.replace(/.*:\/\//, '').replace(/\//g,'--');
}
