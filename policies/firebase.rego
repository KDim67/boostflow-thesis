package main

import rego.v1

deny contains msg if {
	some collection_name, rules in input.rules
	rules.read == true
	msg := sprintf("Firebase collection '%s' has wide-open read access (read: true)", [collection_name])
}

deny contains msg if {
	some collection_name, rules in input.rules
	rules.write == true
	msg := sprintf("Firebase collection '%s' has wide-open write access (write: true)", [collection_name])
}

deny contains msg if {
	some collection_name, rules in input.rules
	rules[".read"] == true
	msg := sprintf("Firebase collection '%s' has wide-open .read access", [collection_name])
}

deny contains msg if {
	some collection_name, rules in input.rules
	rules[".write"] == true
	msg := sprintf("Firebase collection '%s' has wide-open .write access", [collection_name])
}

deny contains msg if {
	some collection_name, rules in input.rules
	rules.read == "true"
	msg := sprintf("Firebase collection '%s' has wide-open read access (read: \"true\")", [collection_name])
}

deny contains msg if {
	some collection_name, rules in input.rules
	rules.write == "true"
	msg := sprintf("Firebase collection '%s' has wide-open write access (write: \"true\")", [collection_name])
}
