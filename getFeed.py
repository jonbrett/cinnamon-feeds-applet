import feedparser, sys, json

if __name__ == "__main__":
    rss = sys.argv[1]
    feed = feedparser.parse(rss)
    info = {}
    
    info["title"] = feed["feed"]["title"]
    info["description"] = feed["feed"]["description"]
    info["link"] = feed["feed"]["link"]
    
    #image is optional in the rss spec
    if "image" in feed["feed"]:
        imageInfo = {}
        try:
            imageInfo["url"] = feed["feed"]["image"]["url"]
            imageInfo["width"] = feed["feed"]["image"]["width"]
            imageInfo["height"] = feed["feed"]["image"]["height"]
            info["image"] = imageInfo
        except Exception, e:
            sys.stderr.write(str(e.args))

    info["entries"] = []
    for item in feed["entries"]:
        itemInfo = {}
        #guid is optional, so use link if it's not given
        if "guid" in item:
            itemInfo["id"] = item["guid"]
        else:
            itemInfo["id"] = item["link"]
        itemInfo["title"] = item["title"]
        itemInfo["link"] = item["link"]
        itemInfo["description"] = item["description"]
        info["entries"].append(itemInfo)
        if "pubDate" in item:
            itemInfo["pubDate"] = item["pubDate"]
        elif "published" in item:
            itemInfo["pubDate"] = item["published"]
        else:
            itemInfo["pubDate"] = None

    print json.dumps(info)
