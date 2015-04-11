#!/usr/bin/env python
# -*- coding:utf-8 -*-
"Makes working with XML feel like you are working with JSON"

from __future__ import print_function

from xml.parsers import expat
from xml.sax.saxutils import XMLGenerator
from xml.sax.xmlreader import AttributesImpl
from gi.repository import GObject, Soup

import sys, dbus

try:  # pragma no cover
    import json
except ImportError:
    import simplejson as json

try:  # pragma no cover
    from cStringIO import StringIO
except ImportError:  # pragma no cover
    try:
        from StringIO import StringIO
    except ImportError:
        from io import StringIO
try:  # pragma no cover
    from collections import OrderedDict
except ImportError:  # pragma no cover
    try:
        from ordereddict import OrderedDict
    except ImportError:
        OrderedDict = dict

try:  # pragma no cover
    _basestring = basestring
except NameError:  # pragma no cover
    _basestring = str
try:  # pragma no cover
    _unicode = unicode
except NameError:  # pragma no cover
    _unicode = str

__author__ = 'Martin Blech'
__version__ = '0.9.2'
__license__ = 'MIT'

SOUP_STATUS_CANCELLED = 1

class Downloader(GObject.GObject):
    __gsignals__ = {
        'progress': (GObject.SignalFlags.RUN_FIRST,
                     None,
                     ([float])),
        'got-chunk': (GObject.SignalFlags.RUN_FIRST,
                      None,
                      (object,)),
        'complete': (GObject.SignalFlags.RUN_FIRST,
                     None,
                     (object,)),
    }
  
    def __init__(self, url, session=None, request_headers=None):
        GObject.GObject.__init__(self)
        self._uri = Soup.URI.new(url)
        self._session = session
        self._get_soup_session()
        self._pending_buffers = []
        self._downloaded_size = 0
        self._total_size = 0
        self._cancelling = False
        self._status_code = None
        self._output_file = None
        self._output_stream = None
        self._message = None
        self._request_headers = request_headers

    def _get_soup_session(self):
        if self._session is None:
            self._session  = Soup.SessionAsync()
            self._session .set_property("timeout", 60)
            self._session .set_property("idle-timeout", 60)
            #self._session .set_property("user-agent", "Sugar/%s" % config.version)
            self._session .add_feature_by_type(Soup.ProxyResolverDefault)
        return self._session
  
    def _setup_message(self, method="GET"):
        self._message = Soup.Message(method=method, uri=self._uri)
        self._message.connect('got-chunk', self._got_chunk_cb)
        self._message.connect('got-headers', self._headers_cb, None)
        if self._request_headers is not None:
            for header_key in self._request_headers.keys():
                self._message.request_headers.append(
                    header_key, self._request_headers[header_key])

    def _soup_status_is_successful(self, status):
        return status >= 200 and status < 300
  
    def download_chunked(self):
        """
        Download the contents of the provided URL into memory. The download
        is done in chunks, and each chunk is emitted over the 'got-chunk'
        signal. Upon completion, a successful download is indicated by a
        reuslt of None in the complete signal parameters.
        """
        self._setup_message()
        self._message.response_body.set_accumulate(False)
        self._session.queue_message(self._message, self._message_cb, None)
  
    def download(self, start=None, end=None):
        """
        Download the contents of the provided URL into memory.
        Upon completion, the downloaded data will be passed as GBytes to the
        result parameter of the complete signal handler.
        The start and end parameters can optionally be set to perform a
        partial read of the remote data.
        """
        self._setup_message()
        if start is not None:
            self._message.request_headers.set_range(start, end)
        self._session.queue_message(self._message, self._message_cb, None)
  
    def get_size(self):
        """
        Perform a HTTP HEAD request to find the size of the remote content.
        The size is returned in the result parameter of the 'complete' signal.
        """
        self._setup_message("HEAD")
        self._session.queue_message(self._message, self._message_cb, None)
  
    def _message_cb(self, session, message, user_data):
        self._status_code = message.status_code
        self._check_if_finished()
  
    def cancel(self):
        self._cancelling = True
        self._session.cancel_message(self._message, SOUP_STATUS_CANCELLED)
  
    def _headers_cb(self, message, user_data):
        if self._soup_status_is_successful(message.status_code):
            self._total_size = message.response_headers.get_content_length()
  
    def _got_chunk_cb(self, message, buf):
        if self._cancelling or \
                not self._soup_status_is_successful(message.status_code):
            return
  
        data = buf.get_as_bytes()
        self.emit('got-chunk', data)
        if self._output_stream:
            self._pending_buffers.append(data)
            self._write_next_buffer()
  
    def __write_async_cb(self, output_stream, result, user_data):
        count = output_stream.write_bytes_finish(result)
  
        self._downloaded_size += count
        if self._total_size > 0:
            progress = self._downloaded_size / float(self._total_size)
            self.emit('progress', progress)
  
        self._check_if_finished()
  
    def _complete(self):
        if self._output_stream:
            self._output_stream.close(None)
  
        result = None
        if self._soup_status_is_successful(self._status_code):
            if self._message.method == "HEAD":
                # this is a get_size request
                result = self._total_size
            elif self._message.response_body.get_accumulate():
                # the message body must be flattened so that it can be
                # retrieved as GBytes because response_body.data gets
                # incorrectly treated by introspection as a NULL-terminated
                # string
                # https://bugzilla.gnome.org/show_bug.cgi?id=704105
                result = self._message.response_body.flatten().get_as_bytes()
            print("passs")
        else:
            result = IOError("HTTP error code %d" % self._status_code)

        self.emit('complete', result)
  
    def _check_if_finished(self):
        # To finish (for both successful completion and cancellation), we
        # require two conditions to become true:
        #  1. Soup message callback has been called
        #  2. Any pending output file write completes
        # Those conditions can become true in either order.
        if not self._output_stream:
            self._complete()
            return
  
        if self._cancelling or not self._pending_buffers:
            if self._status_code is not None \
                    and not self._output_stream.has_pending():
                self._complete()
            return
        self._write_next_buffer()
  
    def _write_next_buffer(self):
        if not self._output_stream.has_pending():
            data = self._pending_buffers.pop(0)
            self._output_stream.write_bytes_async(data, GObject.PRIORITY_LOW,
                                                  None, self.__write_async_cb,
                                                  None)

class ParsingInterrupted(Exception):
    pass


class _DictSAXHandler(object):
    def __init__(self,
                 item_depth=0,
                 item_callback=lambda *args: True,
                 xml_attribs=True,
                 attr_prefix='@',
                 cdata_key='#text',
                 force_cdata=False,
                 cdata_separator='',
                 postprocessor=None,
                 dict_constructor=OrderedDict,
                 strip_whitespace=True,
                 namespace_separator=':',
                 namespaces=None):
        self.path = []
        self.stack = []
        self.data = None
        self.item = None
        self.item_depth = item_depth
        self.xml_attribs = xml_attribs
        self.item_callback = item_callback
        self.attr_prefix = attr_prefix
        self.cdata_key = cdata_key
        self.force_cdata = force_cdata
        self.cdata_separator = cdata_separator
        self.postprocessor = postprocessor
        self.dict_constructor = dict_constructor
        self.strip_whitespace = strip_whitespace
        self.namespace_separator = namespace_separator
        self.namespaces = namespaces

    def _build_name(self, full_name):
        if not self.namespaces:
            return full_name
        i = full_name.rfind(self.namespace_separator)
        if i == -1:
            return full_name
        namespace, name = full_name[:i], full_name[i+1:]
        short_namespace = self.namespaces.get(namespace, namespace)
        if not short_namespace:
            return name
        else:
            return self.namespace_separator.join((short_namespace, name))

    def _attrs_to_dict(self, attrs):
        if isinstance(attrs, dict):
            return attrs
        return self.dict_constructor(zip(attrs[0::2], attrs[1::2]))

    def startElement(self, full_name, attrs):
        name = self._build_name(full_name)
        attrs = self._attrs_to_dict(attrs)
        self.path.append((name, attrs or None))
        if len(self.path) > self.item_depth:
            self.stack.append((self.item, self.data))
            if self.xml_attribs:
                attrs = self.dict_constructor(
                    (self.attr_prefix+key, value)
                    for (key, value) in attrs.items())
            else:
                attrs = None
            self.item = attrs or None
            self.data = None

    def endElement(self, full_name):
        name = self._build_name(full_name)
        if len(self.path) == self.item_depth:
            item = self.item
            if item is None:
                item = self.data
            should_continue = self.item_callback(self.path, item)
            if not should_continue:
                raise ParsingInterrupted()
        if len(self.stack):
            item, data = self.item, self.data
            self.item, self.data = self.stack.pop()
            if self.strip_whitespace and data is not None:
                data = data.strip() or None
            if data and self.force_cdata and item is None:
                item = self.dict_constructor()
            if item is not None:
                if data:
                    self.push_data(item, self.cdata_key, data)
                self.item = self.push_data(self.item, name, item)
            else:
                self.item = self.push_data(self.item, name, data)
        else:
            self.item = self.data = None
        self.path.pop()

    def characters(self, data):
        if not self.data:
            self.data = data
        else:
            self.data += self.cdata_separator + data

    def push_data(self, item, key, data):
        if self.postprocessor is not None:
            result = self.postprocessor(self.path, key, data)
            if result is None:
                return item
            key, data = result
        if item is None:
            item = self.dict_constructor()
        try:
            value = item[key]
            if isinstance(value, list):
                value.append(data)
            else:
                item[key] = [value, data]
        except KeyError:
            item[key] = data
        return item

class XMLToJSON():
    def __init__(self):
        self.loop = GObject.MainLoop() 

    def xml_to_json_format(self, xlm_string): 
        result = self.parse(xlm_string)
        return json.dumps (result)

    def download_xml_to_string(self, request_id, request_url):
        downloader = Downloader(request_url)
        downloader.download_chunked()
        downloader.connect('complete', self.on_download_complete, request_id)
        self.loop.run()

    def on_download_complete(self, downloader, result, request_id):
        self.loop.quit()
        if result is not None:
            try:
                xml_string = str(result, encoding='UTF-8')
            except:
                xml_string = str(result)
            xml_string = '<doc><tag><subtag>data</subtag><t>data1</t><t>data2</t></tag></doc>'
            json_string = self.xml_to_json_format(xml_string)
        else:
            json_string = ""
        try:
            print(request_id + json_string)
            session_bus = dbus.SessionBus()
            dbus_object = session_bus.get_object("org.Cinnamon.FeedReader", "/org/Cinnamon/FeedReader")
            if(dbus_object):
                SetJsonResult = dbus_object.get_dbus_method('SetJsonResult', 'org.Cinnamon.FeedReader')
                if(SetJsonResult):
                    SetJsonResult(request_id, json_string)
        except:
            print("Error, could not find a Dbus implementation.")
        
    def parse(self, xml_input, encoding=None, expat=expat, process_namespaces=False,
              namespace_separator=':', **kwargs):
        """Parse the given XML input and convert it into a dictionary.

        `xml_input` can either be a `string` or a file-like object.

        If `xml_attribs` is `True`, element attributes are put in the dictionary
        among regular child elements, using `@` as a prefix to avoid collisions. If
        set to `False`, they are just ignored.

        Simple example::

            >>> import xmltodict
            >>> doc = xmltodict.parse(\"\"\"
            ... <a prop="x">
            ...   <b>1</b>
            ...   <b>2</b>
            ... </a>
            ... \"\"\")
            >>> doc['a']['@prop']
            u'x'
            >>> doc['a']['b']
            [u'1', u'2']

        If `item_depth` is `0`, the function returns a dictionary for the root
        element (default behavior). Otherwise, it calls `item_callback` every time
        an item at the specified depth is found and returns `None` in the end
        (streaming mode).

        The callback function receives two parameters: the `path` from the document
        root to the item (name-attribs pairs), and the `item` (dict). If the
        callback's return value is false-ish, parsing will be stopped with the
        :class:`ParsingInterrupted` exception.

        Streaming example::

            >>> def handle(path, item):
            ...     print('path:%s item:%s' % (path, item))
            ...     return True
            ...
            >>> xmltodict.parse(\"\"\"
            ... <a prop="x">
            ...   <b>1</b>
            ...   <b>2</b>
            ... </a>\"\"\", item_depth=2, item_callback=handle)
            path:[(u'a', {u'prop': u'x'}), (u'b', None)] item:1
            path:[(u'a', {u'prop': u'x'}), (u'b', None)] item:2

        The optional argument `postprocessor` is a function that takes `path`,
        `key` and `value` as positional arguments and returns a new `(key, value)`
        pair where both `key` and `value` may have changed. Usage example::

            >>> def postprocessor(path, key, value):
            ...     try:
            ...         return key + ':int', int(value)
            ...     except (ValueError, TypeError):
            ...         return key, value
            >>> xmltodict.parse('<a><b>1</b><b>2</b><b>x</b></a>',
            ...                 postprocessor=postprocessor)
            OrderedDict([(u'a', OrderedDict([(u'b:int', [1, 2]), (u'b', u'x')]))])

        You can pass an alternate version of `expat` (such as `defusedexpat`) by
        using the `expat` parameter. E.g:

            >>> import defusedexpat
            >>> xmltodict.parse('<a>hello</a>', expat=defusedexpat.pyexpat)
            OrderedDict([(u'a', u'hello')])

        """
        handler = _DictSAXHandler(namespace_separator=namespace_separator,
                              **kwargs)
        if isinstance(xml_input, _unicode):
            if not encoding:
                encoding = 'utf-8'
            xml_input = xml_input.encode(encoding)
        if not process_namespaces:
            namespace_separator = None
        parser = expat.ParserCreate(
            encoding,
            namespace_separator
        )
        try:
            parser.ordered_attributes = True
        except AttributeError:
            # Jython's expat does not support ordered_attributes
            pass
        parser.StartElementHandler = handler.startElement
        parser.EndElementHandler = handler.endElement
        parser.CharacterDataHandler = handler.characters
        parser.buffer_text = True
        try:
            parser.ParseFile(xml_input)
        except (TypeError, AttributeError):
            parser.Parse(xml_input, True)
        return handler.item


    def _emit(self, key, value, content_handler,
              attr_prefix='@',
              cdata_key='#text',
              depth=0,
              preprocessor=None,
              pretty=False,
              newl='\n',
              indent='\t',
              full_document=True):
        if preprocessor is not None:
            result = preprocessor(key, value)
            if result is None:
                return
            key, value = result
        if not isinstance(value, (list, tuple)):
            value = [value]
        if full_document and depth == 0 and len(value) > 1:
            raise ValueError('document with multiple roots')
        for v in value:
            if v is None:
                v = OrderedDict()
            elif not isinstance(v, dict):
                v = _unicode(v)
            if isinstance(v, _basestring):
                v = OrderedDict(((cdata_key, v),))
            cdata = None
            attrs = OrderedDict()
            children = []
            for ik, iv in v.items():
                if ik == cdata_key:
                    cdata = iv
                    continue
                if ik.startswith(attr_prefix):
                    attrs[ik[len(attr_prefix):]] = iv
                    continue
                children.append((ik, iv))
            if pretty:
                content_handler.ignorableWhitespace(depth * indent)
            content_handler.startElement(key, AttributesImpl(attrs))
            if pretty and children:
                content_handler.ignorableWhitespace(newl)
            for child_key, child_value in children:
                self._emit(child_key, child_value, content_handler,
                           attr_prefix, cdata_key, depth+1, preprocessor,
                           pretty, newl, indent)
            if cdata is not None:
                content_handler.characters(cdata)
            if pretty and children:
                content_handler.ignorableWhitespace(depth * indent)
            content_handler.endElement(key)
            if pretty and depth:
                content_handler.ignorableWhitespace(newl)


    def unparse(self, input_dict, output=None, encoding='utf-8', full_document=True,
                **kwargs):
        """Emit an XML document for the given `input_dict` (reverse of `parse`).

        The resulting XML document is returned as a string, but if `output` (a
        file-like object) is specified, it is written there instead.

        Dictionary keys prefixed with `attr_prefix` (default=`'@'`) are interpreted
        as XML node attributes, whereas keys equal to `cdata_key`
        (default=`'#text'`) are treated as character data.

        The `pretty` parameter (default=`False`) enables pretty-printing. In this
        mode, lines are terminated with `'\n'` and indented with `'\t'`, but this
        can be customized with the `newl` and `indent` parameters.

        """
        if full_document and len(input_dict) != 1:
            raise ValueError('Document must have exactly one root.')
        must_return = False
        if output is None:
            output = StringIO()
            must_return = True
        content_handler = XMLGenerator(output, encoding)
        if full_document:
            content_handler.startDocument()
        for key, value in input_dict.items():
            self._emit(key, value, content_handler, full_document=full_document,
                       **kwargs)
        if full_document:
            content_handler.endDocument()
        if must_return:
            value = output.getvalue()
            try:  # pragma no cover
                value = value.decode(encoding)
            except AttributeError:  # pragma no cover
                pass
            return value

if __name__ == '__main__':  # pragma: no cover
    if len(sys.argv) == 3:
        request_id = sys.argv[1]
        request_url = sys.argv[2]
        xmltojson = XMLToJSON()
        xmltojson.download_xml_to_string(request_id, request_url)
    else:
        print("Invalid number of parameters")
