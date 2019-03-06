'use strict';

const {Adapter, Device, Property} = require('gateway-addon');
const wol = require('wol');
const findDevices = require('local-devices');
const {promise: ping} = require('ping');

class WakeOnLanAdapter extends Adapter {
  constructor(addonManager, manifest) {
    super(addonManager, manifest.name, manifest.name);
    addonManager.addAdapter(this);

    this.checkPing = manifest.moziot.config.checkPing || false;

    findDevices().then((devices) => {
      for (const mac of manifest.moziot.config.devices) {
        const arpDevice = devices.find((d) => d.mac === mac.toLowerCase());
        this.addDevice(arpDevice);
      }
    });

    if (this.checkPing && manifest.moziot.config.devices) {
      this.startPingChecker();
    }
  }

  addDevice(arpDevice) {
    const deviceName = arpDevice && arpDevice.name != '?' && arpDevice.name;
    const wolDevice = new WakeOnLanDevice(this, arpDevice.mac, deviceName);
    if (this.devices.hasOwnProperty(wolDevice.id)) {
      return;
    }
    wolDevice.checkPing(arpDevice.ip);
    this.handleDeviceAdded(wolDevice);
  }

  handleDeviceAdded(device) {
    if (this.checkPing && !this.interval) {
      this.startPingChecker();
    }
    super.handleDeviceAdded(device);
  }

  handleDeviceRemoved(device) {
    super.handleDeviceRemoved(device);
    if (!Object.keys(this.devices).length) {
      this.stopPingChecker();
    }
  }

  startPingChecker() {
    this.interval = setInterval(async () => {
      const devices = await findDevices();
      for (const device of Object.values(this.devices)) {
        const info = devices.find((d) => d.mac === device.mac.toLowerCase());
        if (info) {
          device.checkPing(info.ip);
        }
      }
    }, 30000);
  }

  stopPingChecker() {
    if (this.interval) {
      clearInterval(this.interval);
      delete this.interval;
    }
  }

  unload() {
    this.stopPingChecker();
    return super.unload();
  }
}

class WakeOnLanDevice extends Device {
  constructor(adapter, mac, name) {
    super(adapter, `wake-on-lan-${mac}`);

    this.mac = mac;
    this.name = name || `WoL (${mac})`;
    this.description = `WoL (${mac})`;
    this['@context'] = 'https://iot.mozilla.org/schemas';
    this['@type'] = [];
    this.addAction('wake', {label: 'Wake'});

    if (adapter.checkPing) {
      this.properties.set('on', new PingProperty(this, 'on', {
        type: 'boolean',
        label: 'In Network',
      }, false));
    }
  }

  async checkPing(ip) {
    try {
      const result = await ping.probe(ip);
      this.setOn(result.alive);
    } catch (e) {
      this.setOn(false);
    }
  }

  setOn(isOn) {
    const pingProperty = this.findProperty('on');
    if (pingProperty && pingProperty.value !== isOn) {
      pingProperty.setCachedValue(isOn);
      this.notifyPropertyChanged(pingProperty);
    }
  }

  performAction(action) {
    if (action.name !== 'wake') {
      return Promise.reject('Unknown action');
    }

    return new Promise((resolve, reject) => {
      wol.wake(this.mac, (err, res) => {
        if (err || !res) {
          reject('Wake failed');
          return;
        }

        resolve();
      });
    });
  }
}

class PingProperty extends Property {
  constructor(device, name, description, value) {
    description.readOnly = true;
    super(device, name, description, value);
  }

  setValue() {
    return Promise.reject('Read only property');
  }
}

module.exports = (addonManager, manifest) => {
  new WakeOnLanAdapter(addonManager, manifest);
};
