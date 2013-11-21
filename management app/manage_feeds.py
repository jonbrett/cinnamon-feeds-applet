# -*- encoding: utf-8 -*-
from __future__ import unicode_literals

from functools import partial

import sys

from PyQt4.QtGui import (
    QApplication,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QDesktopWidget,
    QHeaderView,
    QCheckBox
)


class MainWindow(QWidget):

    def __init__(self, feeds):
        super(MainWindow, self).__init__()

        self.feed_list = feeds

        self.setWindowTitle("Manage your RSS feeds")

        self.table = QTableWidget(1, 4)
        self.table.setHorizontalHeaderLabels(["URL", "custom title", "hide", ""])
        self.table.verticalHeader().hide()
        self.table.horizontalHeader().setResizeMode(0, QHeaderView.Stretch)

        # assemble GUI elements
        container = QVBoxLayout()

        container.addWidget(self.table)

        self.addFeedButton = QPushButton("Add feed")
        self.addFeedButton.clicked.connect(self.add_feed)
        container.addWidget(self.addFeedButton)

        buttons = QHBoxLayout()

        self.cancel_button = QPushButton("Cancel")
        self.save_button = QPushButton("Save")

        buttons.addWidget(self.save_button)
        buttons.addWidget(self.cancel_button)

        container.addLayout(buttons)

        self.setLayout(container)
        self.resize(500, 300)
        self.center()

        # connect event handlers

        self.save_button.clicked.connect(self.read_table_entries)

        self.fill_feed_list()

    def center(self):
        """
            Centers the window
        """
        qr = self.frameGeometry()
        cp = QDesktopWidget().availableGeometry().center()
        qr.moveCenter(cp)
        self.move(qr.topLeft())

    def remove_feed(self, row_number):
        """
            removes the entry from the selected line
        """
        print len(self.feed_list)
        del self.feed_list[row_number]
        print len(self.feed_list)
        self.fill_feed_list()

    def add_feed(self):
        self.feed_list.append(
            {
                "url": "",
                "custom_title": None,
                "hidden": False
            }
        )

        self.fill_feed_list()

    def fill_feed_list(self):
        """
            Takes a list of dicts as load_feed_file creates them
            and fills the table widget with the content
        """
        self.table.setRowCount(0)
        # resize table
        self.table.setRowCount(len(self.feed_list))

        for i, feed in enumerate(self.feed_list):
            self.table.setItem(i, 0, QTableWidgetItem(feed["url"]))
            # if no custom title is set, display - None -
            if feed["custom_title"] is None:
                title = "- None -"
            else:
                title = feed["custom_title"]
            self.table.setItem(i, 1, QTableWidgetItem(title))

            # set hide checkbox
            box = QCheckBox()
            if feed["hidden"]:
                box.setChecked(True)
            self.table.setCellWidget(i, 2, box)

            button = QPushButton("delete")
            button.clicked.connect(partial(self.remove_feed, i))
            self.table.setCellWidget(i, 3, button)

    def read_table_entries(self):
        """
            Reads the rows from self.table
            and returns dicts: {"url", "custom_title"}
        """
        feeds = list()

        for i in xrange(self.table.rowCount()):
            url = self.table.item(i, 0)
            title = self.table.item(i, 1)
            checkbox = self.table.cellWidget(i, 2)
            try:
                feeds.append(
                    {
                    "url": unicode(url.text()),
                    "custom_title": unicode(title.text()),
                    "checked": checkbox.isChecked()
                    }
                )
            except AttributeError:
                print "empty"
        from pprint import pprint
        pprint(feeds)


def load_feed_file(filename):
    """
        Reads content of the feed file and returns a list of
        dicts {"url", "custom_title"}
    """
    content = []

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
                content.append(
                    {
                        "url": url,
                        "custom_title": custom_title,
                        "hidden": hidden
                    }
                )
            except IndexError:
                # empty lines are ignored
                pass

    return content


if __name__ == '__main__':

    # get feed file name
    feed_file_name = sys.argv[1]

    app = QApplication([])

    feeds = load_feed_file(feed_file_name)

    app.window = MainWindow(feeds)

    app.window.show()

    sys.exit(app.exec_())
