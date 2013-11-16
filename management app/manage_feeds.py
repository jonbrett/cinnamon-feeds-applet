# -*- encoding: utf-8 -*-
from __future__ import unicode_literals

import sys

from PyQt4.QtGui import (
    QApplication,
    QTableWidget,
    QTableWidgetItem,
    QGridLayout,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton
)

class MainWindow(QWidget):

    def __init__(self):
        super(MainWindow, self).__init__()

        self.setWindowTitle("Manage your RSS feeds")

        self.table = QTableWidget(5,2)
        self.table.setHorizontalHeaderLabels(["URL", "custom title"])
        self.table.verticalHeader().hide()

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

if __name__ == '__main__':

    # get feed file name
    feed_file_name = sys.argv[1]

    app = QApplication([])

    app.window = MainWindow()

    app.window.show()
    
    sys.exit(app.exec_())
    
