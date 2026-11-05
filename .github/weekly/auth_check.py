"""Manual TLS/login/quit only. No message, API calls, artifacts or state writes."""
import os
import smtplib
import ssl


def authenticate():
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise ValueError("Authentication check is manual only")
    password = os.environ.get("WEEKLY_REPORT_GMAIL_APP_PASSWORD")
    if not password:
        raise ValueError("Mail secret unavailable")
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login("joe@exceptional-entertainment.com", password)
        # The context manager sends QUIT; never MAIL/RCPT/DATA or send_message.


def main():
    try:
        authenticate()
        print("Gmail TLS authentication succeeded. No email sent; no state written.")
        return 0
    except Exception:
        print("Gmail authentication check failed. Check secret availability and Google account policy; no email sent.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())