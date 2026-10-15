"""Worker-wide error classes (a leaf: imports nothing from the package)."""


class TerminalJobError(Exception):
    """Bad input / unrecoverable — do NOT retry (maps to BullMQ UnrecoverableError)."""
