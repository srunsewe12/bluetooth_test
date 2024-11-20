/* eslint-disable no-bitwise */
import { useMemo, useState, useEffect } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  BleError,
  BleManager,
  Characteristic,
  Device,
} from "react-native-ble-plx";

import * as ExpoDevice from "expo-device";

import base64 from "react-native-base64";

const HEART_RATE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
const HEART_RATE_CHARACTERISTIC = "00002a37-0000-1000-8000-00805f9b34fb";

interface BluetoothLowEnergyApi {
  requestPermissions(): Promise<boolean>;
  scanForPeripherals(): void;
  connectToDevice: (deviceId: Device) => Promise<void>;
  disconnectFromDevice: () => void;
  connectedDevice: Device | null;
  allDevices: Device[];
  heartRate: number;
  bluetoothState: string;
}

function useBLE(): BluetoothLowEnergyApi {
  const bleManager = useMemo(() => new BleManager(), []);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [heartRate, setHeartRate] = useState<number>(0);
  const [isManagerInitialized, setIsManagerInitialized] = useState(false);
  const [bluetoothState, setBluetoothState] = useState('Unknown');

  useEffect(() => {
    const initializeBLE = async () => {
      try {
        const state = await bleManager.state();
        console.log('Initial BLE state:', state);
        setBluetoothState(state);
        
        if (state === 'PoweredOn') {
          setIsManagerInitialized(true);
        }
      } catch (error) {
        console.error('Failed to initialize BLE:', error);
      }
    };

    const subscription = bleManager.onStateChange((state) => {
      console.log('BLE state changed:', state);
      setBluetoothState(state);
      if (state === 'PoweredOn') {
        setIsManagerInitialized(true);
      } else {
        setIsManagerInitialized(false);
      }
    }, true);

    initializeBLE();

    return () => {
      subscription.remove();
      bleManager.destroy();
    };
  }, []);

  const requestAndroid31Permissions = async () => {
    const bluetoothScanPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      {
        title: "Location Permission",
        message: "Bluetooth Low Energy requires Location",
        buttonPositive: "OK",
      }
    );
    const bluetoothConnectPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: "Location Permission",
        message: "Bluetooth Low Energy requires Location",
        buttonPositive: "OK",
      }
    );
    const fineLocationPermission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: "Location Permission",
        message: "Bluetooth Low Energy requires Location",
        buttonPositive: "OK",
      }
    );

    return (
      bluetoothScanPermission === "granted" &&
      bluetoothConnectPermission === "granted" &&
      fineLocationPermission === "granted"
    );
  };

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      if ((ExpoDevice.platformApiLevel ?? -1) < 31) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: "Location Permission",
            message: "Bluetooth Low Energy requires Location",
            buttonPositive: "OK",
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        const isAndroid31PermissionsGranted =
          await requestAndroid31Permissions();

        return isAndroid31PermissionsGranted;
      }
    } else {
      return true;
    }
  };

  const isDuplicteDevice = (devices: Device[], nextDevice: Device) =>
    devices.findIndex((device) => nextDevice.id === device.id) > -1;

  const scanForPeripherals = async () => {
    try {
      if (!isManagerInitialized) {
        console.log('BLE Manager not initialized');
        return;
      }

      if (bluetoothState !== 'PoweredOn') {
        console.log('Bluetooth is not powered on');
        return;
      }

      const permissionsGranted = await requestPermissions();
      if (!permissionsGranted) {
        console.log('Required permissions not granted');
        return;
      }

      console.log("Starting device scan...");
      bleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.error("Scan error:", error);
          return;
        }

        if (device) {
          console.log("Found device:", {
            name: device.name,
            id: device.id,
            rssi: device.rssi
          });

          setAllDevices((prevState: Device[]) => {
            if (!isDuplicteDevice(prevState, device)) {
              return [...prevState, device];
            }
            return prevState;
          });
        }
      });

      setTimeout(() => {
        bleManager.stopDeviceScan();
        console.log("Stopped device scan");
      }, 50000);

    } catch (error) {
      console.error("Scan failed:", error);
    }
  };

  const connectToDevice = async (device: Device) => {
    try {
      if (!isManagerInitialized) {
        console.log('BLE Manager not initialized');
        return;
      }

      console.log("Attempting to connect to device:", device.name, device.id);
      const deviceConnection = await bleManager.connectToDevice(device.id);
      console.log("Connected to device:", deviceConnection.name);

      setConnectedDevice(deviceConnection);
      const services = await deviceConnection.discoverAllServicesAndCharacteristics();
      console.log("Discovered services:", services);

      bleManager.stopDeviceScan();
      startStreamingData(deviceConnection);
    } catch (e) {
      console.error("Failed to connect:", e);
      
      // Optional: Implement retry logic
      // setTimeout(() => {
      //   console.log("Retrying connection to device:", device.name);
      //   connectToDevice(device);
      // }, 5000);
    }
  };

  const disconnectFromDevice = () => {
    if (connectedDevice) {
      bleManager.cancelDeviceConnection(connectedDevice.id);
      setConnectedDevice(null);
      setHeartRate(0);
    }
  };

  const onHeartRateUpdate = (
    error: BleError | null,
    characteristic: Characteristic | null
  ) => {
    if (error) {
      console.log(error);
      return -1;
    } else if (!characteristic?.value) {
      console.log("No Data was recieved");
      return -1;
    }

    const rawData = base64.decode(characteristic.value);
    let innerHeartRate: number = -1;

    const firstBitValue: number = Number(rawData) & 0x01;

    if (firstBitValue === 0) {
      innerHeartRate = rawData[1].charCodeAt(0);
    } else {
      innerHeartRate =
        Number(rawData[1].charCodeAt(0) << 8) +
        Number(rawData[2].charCodeAt(2));
    }

    setHeartRate(innerHeartRate);
  };

  const startStreamingData = async (device: Device) => {
    if (device) {
      device.monitorCharacteristicForService(
        HEART_RATE_UUID,
        HEART_RATE_CHARACTERISTIC,
        onHeartRateUpdate
      );
    } else {
      console.log("No Device Connected");
    }
  };

  return {
    scanForPeripherals,
    requestPermissions,
    connectToDevice,
    allDevices,
    connectedDevice,
    disconnectFromDevice,
    heartRate,
    bluetoothState,
  };
}

export default useBLE;
