"""Market data resolution.

A provider chain turns a ticker into a MarketSnapshot: a live provider (when a
key is configured) supplies the real price; the offline reference table always
backstops it, so resolution never fails. The deterministic forecast engine
(services/stock.py) consumes the snapshot — its formulas are unchanged, only its
price input goes live.
"""
