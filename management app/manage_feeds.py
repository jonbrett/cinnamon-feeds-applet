# -*- encoding: utf-8 -*-
from __future__ import unicode_literals

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
    QHeaderView
)


class MainWindow(QWidget):

    def __init__(self):
        super(MainWindow, self).__init__()

        self.setWindowTitle("Manage your RSS feeds")

        self.table = QTableWidget(5, 2)
        self.table.setHorizontalHeaderLabels(["URL", "custom title"])
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

    def center(self):
        """
            Centers the window
        """
        qr = self.frameGeometry()
        cp = QDesktopWidget().availableGeometry().center()
        qr.moveCenter(cp)
        self.move(qr.topLeft())

    def fill_feed_list(self, feeds):
        """
            Takes a list of dicts as load_feed_file creates them
            and fills the table widget with the content
        """
        for i, feed in enumerate(feeds):
            self.table.setItem(i, 0, QTableWidgetItem(feed["url"]))
            # if no custom title is set, display - None -
            if feed["custom_title"] is None:
                title = "- None -"
            else:
                title = feed["custom_title"]
            self.table.setItem(i, 1, QTableWidgetItem(title))


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
                    continue
                temp = line.split()
                url = temp[0]
                custom_title = None
                if len(temp) > 1:
                    custom_title = " ".join(temp[1:])
                content.append(
                    {
                        "url": url,
                        "custom_title": custom_title
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
