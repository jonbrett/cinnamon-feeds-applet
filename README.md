cinnamon-feeds-applet
=====================

Cinnamon applet for fetching and displaying RSS feeds

Prerequisites
=============
If not already installed by your distribution, install the python feedparser library. E.g.
using pip:

sudo pip install feedparser

Installation
============
The latest stable release can be installed from
* The Cinnamon spices Website [http://cinnamon-spices.linuxmint.com/applets/view/149]
* Directly from the Cinnamon applets settings (right-click the Cinnamon panel and got to "add applets"

Alternatively you can clone this repository and compile it yourself.
```
git clone https://github.com/jonbrett/cinnamon-feeds-applet.git feeds@jonbrettdev.wordpress.com
cd feeds@jonbrettdev.wordpress.com
make
cp -r ./BUILD/feeds@jonbrettdev.wordpress.com ~/.local/share/cinnamon/applets
```

If you intend on modifying the codebase, remember to commit your changes before compiling. The BUILD directory will only contain code committed to Git.