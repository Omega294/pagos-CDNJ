import io
import json
import urllib.parse
import sys
import os
import threading

# Add application directory to sys.path
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

from server import CDNJHandler, init_db, backup_scheduler_worker

# Initialize Database and Scheduler on startup
init_db()

# Start background backup scheduler thread once per worker
_backup_thread_started = False
if not _backup_thread_started:
    try:
        t = threading.Thread(target=backup_scheduler_worker, daemon=True)
        t.start()
        _backup_thread_started = True
    except Exception as e:
        print(f"Warning: Could not start backup scheduler: {e}")

HTTP_STATUS_PHRASES = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    500: "Internal Server Error"
}

class WSGICDNJAdapter(CDNJHandler):
    """
    Adapter that allows CDNJHandler to process WSGI requests seamlessly
    under LiteSpeed / CloudLinux Passenger in cPanel.
    """
    def __init__(self, environ):
        self.environ = environ
        path = environ.get('PATH_INFO', '')
        query = environ.get('QUERY_STRING', '')
        self.path = f"{path}?{query}" if query else (path or '/')
        
        self.headers = {}
        for key, value in environ.items():
            if key.startswith('HTTP_'):
                # HTTP_AUTHORIZATION -> Authorization, HTTP_CONTENT_TYPE -> Content-Type
                header_name = key[5:].replace('_', '-').title()
                self.headers[header_name] = value
            elif key in ('CONTENT_LENGTH', 'CONTENT_TYPE'):
                header_name = key.replace('_', '-').title()
                self.headers[header_name] = value
                
        self.rfile = environ.get('wsgi.input') or io.BytesIO(b'')
        self.wfile = io.BytesIO()
        self.response_status = 200
        self.response_headers = []
        self._headers_ended = False

    def send_response(self, code, message=None):
        self.response_status = code

    def send_header(self, keyword, value):
        self.response_headers.append((keyword, str(value)))

    def end_headers(self):
        self._headers_ended = True


def application(environ, start_response):
    """
    WSGI Entry Point for LiteSpeed / cPanel Passenger
    """
    adapter = WSGICDNJAdapter(environ)
    method = environ.get('REQUEST_METHOD', 'GET').upper()
    
    try:
        if method == 'GET':
            adapter.do_GET()
        elif method == 'POST':
            adapter.do_POST()
        elif method == 'OPTIONS':
            adapter.do_OPTIONS()
        else:
            adapter.send_json({"error": "Método no permitido"}, 405)
    except Exception as e:
        import traceback
        traceback.print_exc()
        adapter.send_json({"error": "Error interno del servidor", "details": str(e)}, 500)

    status_phrase = HTTP_STATUS_PHRASES.get(adapter.response_status, "OK")
    status_str = f"{adapter.response_status} {status_phrase}"
    
    start_response(status_str, adapter.response_headers)
    return [adapter.wfile.getvalue()]
