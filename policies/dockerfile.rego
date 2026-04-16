package main

import rego.v1

deny contains msg if {
	some instruction in input.Stages[0].Commands
	instruction.Cmd == "from"
	some val in instruction.Value
	endswith(val, ":latest")
	msg := sprintf("FROM uses 'latest' tag: '%s' — pin a specific version or digest", [val])
}

deny contains msg if {
	some instruction in input.Stages[0].Commands
	instruction.Cmd == "from"
	some val in instruction.Value
	not contains(val, ":")
	not contains(val, "@")
	val != "scratch"
	msg := sprintf("FROM has no tag or digest: '%s' — pin a specific version", [val])
}

has_user if {
	some stage in input.Stages
	some instruction in stage.Commands
	instruction.Cmd == "user"
}

deny contains msg if {
	not has_user
	msg := "Dockerfile must include a USER instruction to run as non-root"
}

deny contains msg if {
	some stage in input.Stages
	some instruction in stage.Commands
	instruction.Cmd == "add"
	not startswith(instruction.Value[0], "http")
	not endswith(instruction.Value[0], ".tar")
	not endswith(instruction.Value[0], ".tar.gz")
	not endswith(instruction.Value[0], ".tgz")
	msg := sprintf("Use COPY instead of ADD for local files: '%s'", [instruction.Value[0]])
}

deny contains msg if {
	some stage in input.Stages
	some instruction in stage.Commands
	instruction.Cmd == "run"
	some val in instruction.Value
	contains(val, "curl")
	contains(val, "| bash")
	msg := sprintf("Avoid piping curl to bash — download and verify scripts before execution: '%s'", [val])
}

deny contains msg if {
	some stage in input.Stages
	some instruction in stage.Commands
	instruction.Cmd == "run"
	some val in instruction.Value
	contains(val, "curl")
	contains(val, "| sh")
	msg := sprintf("Avoid piping curl to sh — download and verify scripts before execution: '%s'", [val])
}

deny contains msg if {
	some stage in input.Stages
	some instruction in stage.Commands
	instruction.Cmd == "run"
	some val in instruction.Value
	contains(val, "wget")
	contains(val, "| bash")
	msg := sprintf("Avoid piping wget to bash — download and verify scripts before execution: '%s'", [val])
}

deny contains msg if {
	some stage in input.Stages
	some instruction in stage.Commands
	instruction.Cmd == "run"
	some val in instruction.Value
	contains(val, "wget")
	contains(val, "| sh")
	msg := sprintf("Avoid piping wget to sh — download and verify scripts before execution: '%s'", [val])
}
