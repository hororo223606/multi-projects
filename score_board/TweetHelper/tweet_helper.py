import json
import os
import sys
import webbrowser
import urllib.parse
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QTextEdit,
    QPushButton, QLineEdit, QLabel
)
from PyQt6.QtGui import QClipboard

def tw(t):
    if not t or not t.strip():
        return ""
    t = t.strip()
    if not t.startswith("@"):
        t = "@" + t
    return f" ({t})"

class App(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("StreamControl Tweet Helper")
        self.resize(300, 300)

        self.text = QTextEdit()

        self.btn_gen = QPushButton("生成")
        self.btn_copy = QPushButton("コピー")
        self.btn_tweet = QPushButton("投稿画面を開く")

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Tweet Preview"))
        layout.addWidget(self.text)
        layout.addWidget(self.btn_gen)
        layout.addWidget(self.btn_copy)
        layout.addWidget(self.btn_tweet)

        self.btn_gen.clicked.connect(self.generate)
        self.btn_copy.clicked.connect(self.copy)
        self.btn_tweet.clicked.connect(self.open_tweet)

        self.generate()

    def generate(self):
        path = os.path.join(os.path.dirname(sys.argv[0]), "..", "streamcontrol.json")
        if not os.path.exists(path):
            self.text.setPlainText("streamcontrol.json が見つかりません")
            return

        with open(path, encoding="utf-8") as f:
            j = json.load(f)

        stage = j.get("stage", "")
        p1 = f'{j.get("pTeam1","")}|{j.get("pName1","")}{tw(j.get("pTwitter1",""))}'
        p2 = f'{j.get("pTeam2","")}|{j.get("pName2","")}{tw(j.get("pTwitter2",""))}'
        stream_url = j.get("streamUrl", "").strip()

        lines = []
        if stage:
            lines.append(f"🍀{stage}🍀")
        lines.append(f"{p1} vs {p2}")
        if stream_url:
            lines.append(f"({stream_url})")

        self.text.setPlainText("\n".join(lines))

    def copy(self):
        QApplication.clipboard().setText(self.text.toPlainText())

    def open_tweet(self):
        self.generate()
        text = self.text.toPlainText()
        encoded = urllib.parse.quote(text)

        webbrowser.open(
            "https://x.com/intent/tweet?text=" + encoded
        )
        #webbrowser.open(
        #    "https://twitter.com/intent/tweet?text="
        #    + self.text.toPlainText()
        #)

app = QApplication(sys.argv)
w = App()
w.show()
sys.exit(app.exec())
