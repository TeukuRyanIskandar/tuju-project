"""Harness sanity test — proves the uv-managed pytest harness runs.

Real worker unit tests live in ``test_handler.py`` (ticket 05); this remains as a
trivial infra-free check.
"""

import pytest

pytestmark = pytest.mark.unit


def test_placeholder_harness_runs() -> None:
    assert True
