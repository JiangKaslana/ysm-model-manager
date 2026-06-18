package geometry

import "testing"

func TestParseBedrockGeometryVariantNameFallsBackFromUnknownIdentifier(t *testing.T) {
	data := []byte(`{
		"format_version": "1.12.0",
		"minecraft:geometry": [{
			"description": {
				"identifier": "unknown",
				"texture_width": 64,
				"texture_height": 64
			},
			"bones": [{
				"name": "Body",
				"pivot": [0, 0, 0],
				"cubes": [{
					"origin": [0, 0, 0],
					"size": [1, 1, 1],
					"uv": [0, 0]
				}]
			}]
		}]
	}`)

	models := ParseBedrockGeometryVariants(data, "models/main.json")
	if len(models) != 1 {
		t.Fatalf("variants = %d, want 1", len(models))
	}
	if models[0].Name != "main" {
		t.Fatalf("variant name = %q, want main", models[0].Name)
	}
}

func TestParsePlayerMainModelRefsKeepsOnlyMainForObject(t *testing.T) {
	refs := parsePlayerMainModelRefs([]byte(`{
		"main": "models/main.json",
		"arm": "models/arm.json",
		"wheel": "models/wheel.json"
	}`))

	if len(refs) != 1 || refs[0] != "models/main.json" {
		t.Fatalf("refs = %#v, want only main", refs)
	}
}

func TestParsePlayerMainModelRefsKeepsArrayCompatibility(t *testing.T) {
	refs := parsePlayerMainModelRefs([]byte(`[
		"models/a.json",
		"models/b.json"
	]`))

	if len(refs) != 2 || refs[0] != "models/a.json" || refs[1] != "models/b.json" {
		t.Fatalf("refs = %#v, want array values", refs)
	}
}
