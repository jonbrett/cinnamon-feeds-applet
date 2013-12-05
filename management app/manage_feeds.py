#!/usr/bin/env python
# -*- encoding: utf-8 -*-
from __future__ import unicode_literals
from gi.repository import Gtk

import sys
import os

class MainWindow(Gtk.Window):

    def __init__(self, filename):
        super(Gtk.Window, self).__init__(title="Manage your feeds")

        self.filename = filename;
        self.feeds = self.load_feed_file(filename);

        # Set window properties
        self.set_default_size(500, 200)
        icon_path = os.path.abspath(os.path.join(os.path.dirname(__file__),"../icon.png"))
        self.set_icon_from_file(icon_path)

        box = Gtk.Box(False, 10, orientation=Gtk.Orientation.VERTICAL);
        button_box = Gtk.Box(False, 10);

        # Build feed table
        self.treeview = Gtk.TreeView(model=self.feeds)
        self.treeview.set_reorderable(True)

        renderer_url= Gtk.CellRendererText()
        renderer_url.set_property("editable", True)
        renderer_url.connect("edited", self.url_edited)
        column_url = Gtk.TreeViewColumn("Url", renderer_url, text=0)
        column_url.set_expand(True)
        self.treeview.append_column(column_url)

        renderer_title= Gtk.CellRendererText()
        renderer_title.set_property("editable", True)
        renderer_title.connect("edited", self.title_edited)
        column_title = Gtk.TreeViewColumn("Custom title", renderer_title, text=1)
        column_title.set_expand(True)
        self.treeview.append_column(column_title)

        renderer_enable = Gtk.CellRendererToggle()
        renderer_enable.connect("toggled", self.enable_toggled)
        column_enable = Gtk.TreeViewColumn("Enable", renderer_enable, active=2)
        column_enable.set_expand(False)
        self.treeview.append_column(column_enable)

        box.pack_start(self.treeview, True, True, 0)

        # Add buttons
        add_button = Gtk.Button(stock=Gtk.STOCK_ADD)
        add_button.connect("clicked", self.new_feed)

        del_button = Gtk.Button(stock=Gtk.STOCK_DELETE)
        del_button.connect("clicked", self.remove_feed)

        cancel_button = Gtk.Button(stock=Gtk.STOCK_CANCEL)
        cancel_button.connect("clicked", Gtk.main_quit)

        save_button = Gtk.Button(stock=Gtk.STOCK_APPLY)
        save_button.connect("clicked", self.write_feed_file)
        save_button.connect("clicked", Gtk.main_quit)

        button_box.pack_start(add_button, False, False, 0);
        button_box.pack_start(del_button, False, False, 0);
        button_box.pack_end(save_button, False, False, 0);
        button_box.pack_end(cancel_button, False, False, 0);

        box.add(button_box)

        self.add(box)

    def url_edited(self, widget, path, text):
        self.feeds[path][0] = text

    def title_edited(self, widget, path, text):
        if len(text) > 0:
            self.feeds[path][1] = text
        else:
            self.feeds[path][1] = None

    def enable_toggled(self, widget, path):
        self.feeds[path][2] = not self.feeds[path][2]

    def remove_feed(self, button):
        selection = self.treeview.get_selection()
        result = selection.get_selected()
        if result:
            model, iter = result
        model.remove(iter)

    def new_feed(self, button):
        self.feeds.append(["http://", "", True])
        self.treeview.set_cursor(len(self.feeds) - 1,
                        self.treeview.get_column(0), True)

    def write_feed_file(self, button):
        """
            Writes the feeds list to the file/stdout
        """
        if self.filename is None:
            f = sys.stdout
        else:
            f = open(self.filename, "w")

        for feed in self.feeds:
            comment = "#" if not feed[2] else ''
            title = ''
            if not feed[1] is None:
                title = " %s" % feed[1]
            f.write("%s%s%s\n" % (comment, feed[0], title))

    def load_feed_file(self, filename):
        """
            Reads content of the feed file/stdin and returns a GTK.ListStore
        """
        content = Gtk.ListStore(str, str, bool)

        if (filename is None):
            f = sys.stdin
        else:
            f = open(filename, "r")

        for line in f:
            try:
                if line[0] == "#":
                    # cut out the comment and define this item as disabled
                    line = line[1:]
                    enable = False
                else:
                    enable = True
                temp = line.split()
                url = temp[0]
                custom_title = None
                if len(temp) > 1:
                    custom_title = " ".join(temp[1:])
                content.append([url, custom_title, enable])
            except IndexError:
                # empty lines are ignored
                pass

        return content


if __name__ == '__main__':

    # get feed file name
    if len(sys.argv) > 1:
        feed_file_name = sys.argv[1]
    else:
        feed_file_name = None

    window = MainWindow(filename=feed_file_name)
    window.connect("delete-event", Gtk.main_quit);
    window.show_all()
    Gtk.main()
