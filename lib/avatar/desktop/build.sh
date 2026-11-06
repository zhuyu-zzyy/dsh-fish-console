#!/bin/sh
set -eu
cd "$(dirname "$0")"
xcrun clang -fobjc-arc -O2 -mmacosx-version-min=12.0 -arch arm64 -arch x86_64 -framework AppKit -framework WebKit -framework AVFoundation -Wl,-sectcreate,__TEXT,__info_plist,Info.plist FishPet.m -o FishPet
/usr/bin/codesign --force --sign - FishPet
