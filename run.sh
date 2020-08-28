#!/bin/bash

# disable wifi power management
# iwconfig wlan0 power off

cd "$(dirname "$0")"
node index.js &>> log/log.txt
