package main

import rego.v1

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.securityContext.runAsNonRoot
	msg := sprintf("Container '%s' in Deployment '%s' must set securityContext.runAsNonRoot to true", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.securityContext.runAsNonRoot
	msg := sprintf("Container '%s' in StatefulSet '%s' must set securityContext.runAsNonRoot to true", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	container.securityContext.allowPrivilegeEscalation
	msg := sprintf("Container '%s' in Deployment '%s' must not allow privilege escalation", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	container.securityContext.allowPrivilegeEscalation
	msg := sprintf("Container '%s' in StatefulSet '%s' must not allow privilege escalation", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.securityContext.readOnlyRootFilesystem
	msg := sprintf("Container '%s' in Deployment '%s' must set readOnlyRootFilesystem to true", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.securityContext.readOnlyRootFilesystem
	msg := sprintf("Container '%s' in StatefulSet '%s' must set readOnlyRootFilesystem to true", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.resources.limits
	msg := sprintf("Container '%s' in Deployment '%s' must set resource limits", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.resources.limits
	msg := sprintf("Container '%s' in StatefulSet '%s' must set resource limits", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.resources.requests
	msg := sprintf("Container '%s' in Deployment '%s' must set resource requests", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.resources.requests
	msg := sprintf("Container '%s' in StatefulSet '%s' must set resource requests", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.securityContext.capabilities.drop
	msg := sprintf("Container '%s' in Deployment '%s' must drop all capabilities", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.securityContext.capabilities.drop
	msg := sprintf("Container '%s' in StatefulSet '%s' must drop all capabilities", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not has_all_drop(container)
	msg := sprintf("Container '%s' in Deployment '%s' must drop ALL capabilities", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not has_all_drop(container)
	msg := sprintf("Container '%s' in StatefulSet '%s' must drop ALL capabilities", [container.name, input.metadata.name])
}

has_all_drop(container) if {
	some cap in container.securityContext.capabilities.drop
	cap == "ALL"
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.livenessProbe
	msg := sprintf("Container '%s' in Deployment '%s' must define a livenessProbe", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.readinessProbe
	msg := sprintf("Container '%s' in Deployment '%s' must define a readinessProbe", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.livenessProbe
	msg := sprintf("Container '%s' in StatefulSet '%s' must define a livenessProbe", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.readinessProbe
	msg := sprintf("Container '%s' in StatefulSet '%s' must define a readinessProbe", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	input.spec.template.spec.hostNetwork
	msg := sprintf("Deployment '%s' must not use hostNetwork", [input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	input.spec.template.spec.hostPID
	msg := sprintf("Deployment '%s' must not use hostPID", [input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	input.spec.template.spec.hostNetwork
	msg := sprintf("StatefulSet '%s' must not use hostNetwork", [input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	input.spec.template.spec.hostPID
	msg := sprintf("StatefulSet '%s' must not use hostPID", [input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	endswith(container.image, ":latest")
	msg := sprintf("Container '%s' in Deployment '%s' must not use the 'latest' tag — pin a specific version", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	endswith(container.image, ":latest")
	msg := sprintf("Container '%s' in StatefulSet '%s' must not use the 'latest' tag — pin a specific version", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not contains(container.image, ":")
	msg := sprintf("Container '%s' in Deployment '%s' must specify an image tag", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not contains(container.image, ":")
	msg := sprintf("Container '%s' in StatefulSet '%s' must specify an image tag", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind in {"Deployment", "StatefulSet"}
	not input.spec.template.spec.automountServiceAccountToken == false
	msg := sprintf("%s '%s' should set automountServiceAccountToken to false", [input.kind, input.metadata.name])
}

deny contains msg if {
	input.kind == "Deployment"
	some container in input.spec.template.spec.containers
	not container.securityContext.seccompProfile.type
	msg := sprintf("Container '%s' in Deployment '%s' must set a seccomp profile", [container.name, input.metadata.name])
}

deny contains msg if {
	input.kind == "StatefulSet"
	some container in input.spec.template.spec.containers
	not container.securityContext.seccompProfile.type
	msg := sprintf("Container '%s' in StatefulSet '%s' must set a seccomp profile", [container.name, input.metadata.name])
}
