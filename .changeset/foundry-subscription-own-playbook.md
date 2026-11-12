---
"glove-foundry": patch
---

An agent created on its own that carries the same playbook as a subscription answers for itself again. Since 0.13.0 a subscription's playbook was skipped on every instance, so such an agent stopped waking for inbound events. The skip now applies only to the instances the subscription put the playbook on: the ones it provisioned and the existing ones it names.

A subscription's instances are told by their provisioning key (or, for an `existing` target, by id). An instance another subscription provisioned, or a durable subagent, that an operator gives the same playbook to also answers for itself.
