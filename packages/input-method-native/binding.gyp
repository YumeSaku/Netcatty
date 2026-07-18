{
  "targets": [
    {
      "target_name": "input_method_native",
      "sources": ["src/input_method.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["user32.lib", "imm32.lib"]
        }]
      ]
    }
  ]
}
