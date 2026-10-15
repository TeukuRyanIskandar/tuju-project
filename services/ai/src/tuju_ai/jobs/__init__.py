"""The job pipeline (architecture-deepening ticket 02); see :mod:`.pipeline`.

Each job family declares a :class:`~.pipeline.JobDefinition` next to its own
domain code; :mod:`tuju_ai.handler` dispatches a job name to its definition.
"""
