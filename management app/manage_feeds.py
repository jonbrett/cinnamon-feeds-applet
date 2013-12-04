#!/usr/bin/env python
# -*- encoding: utf-8 -*-
from __future__ import unicode_literals
from gi.repository import Gtk

import sys

class MainWindow(Gtk.Window):

    def __init__(self, filename):
        super(Gtk.Window, self).__init__(title="Manage your feeds")

        self.filename = filename;
        self.feeds = self.load_feed_file(filename);

        self.set_default_size(500, 200)

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

        renderer_hidden = Gtk.CellRendererToggle()
        renderer_hidden.connect("toggled", self.hidden_toggled)
        column_hidden = Gtk.TreeViewColumn("Disabled", renderer_hidden, active=2)
        column_hidden.set_expand(False)
        self.treeview.append_column(column_hidden)

        self.add(self.treeview)

    def url_edited(self, widget, path, text):
        self.feeds[path][0] = text

    def title_edited(self, widget, path, text):
        if len(text) > 0:
            self.feeds[path][1] = text
        else:
            self.feeds[path][1] = None

    def hidden_toggled(self, widget, path):
        self.feeds[path][2] = not self.feeds[path][2]

    def remove_feed(self):
        selection = self.treeview.get_selection()
        result = selection.get_selected()
        if result:
            model, iter = result
        model.remove(iter)

    def new_feed(self):
        self.feeds.append("URL", "", False)

    def write_feed_file(self):
        """
            Writes the feeds list to the file
        """

        with open(self.feed_file, "w") as f:
            for feed in [r[0:3] for r in self.feeds]:
                comment = "#" if feed[2] else ''
                title = ''
                if not feed[1] is None:
                    title = " %s" % feed[1]
                f.write("%s%s%s\n" % (comment, feed[0], title))

    def load_feed_file(self, filename):
        """
            Reads content of the feed file and returns a GTK.ListStore
        """
        content = Gtk.ListStore(str, str, bool)
        with open(filename, "r") as f:
            for line in f:
                try:
                    if line[0] == "#":
                        # cut out the comment and define this item as hidden
                        line = line[1:]
                        hidden = True
                    else:
                        hidden = False
                    temp = line.split()
                    url = temp[0]
                    custom_title = None
                    if len(temp) > 1:
                        custom_title = " ".join(temp[1:])
                    content.append([url, custom_title, hidden])
                except IndexError:
                    # empty lines are ignored
                    pass

        return content


if __name__ == '__main__':

    # get feed file name
    feed_file_name = sys.argv[1]

    window = MainWindow(filename=feed_file_name)
    window.connect("delete-event", Gtk.main_quit);
    window.show_all()
    Gtk.main()
