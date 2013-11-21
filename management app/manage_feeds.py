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

    def __init__(self):
        super(MainWindow, self).__init__()

        self.setWindowTitle("Manage your RSS feeds")

        self.table = QTableWidget(1, 4)
        self.table.setHorizontalHeaderLabels(["URL", "custom title", "hide", ""])
        self.table.verticalHeader().hide()
        self.table.horizontalHeader().setResizeMode(0, QHeaderView.Stretch)

        # assemble GUI elements
        container = QVBoxLayout()

        container.addWidget(self.table)

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

    def center(self):
        """
            Centers the window
        """
        qr = self.frameGeometry()
        cp = QDesktopWidget().availableGeometry().center()
        qr.moveCenter(cp)
        self.move(qr.topLeft())

    def remove_entry(self, row_number):
        """
            removes the entry from the selected line
        """
        self.table.removeRow(row_number)

    def fill_feed_list(self, feeds):
        """
            Takes a list of dicts as load_feed_file creates them
            and fills the table widget with the content
        """

        # resize table
        self.table.setRowCount(len(feeds) + 1)

        for i, feed in enumerate(feeds):
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
            button.clicked.connect(partial(self.remove_entry, i))
            self.table.setCellWidget(i, 3, button)

        # add the checkbox in the last row
        box = QCheckBox()
        self.table.setCellWidget(len(feeds), 2, box)

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

    app.window = MainWindow()

    app.window.fill_feed_list(feeds)

    app.window.show()

    sys.exit(app.exec_())
