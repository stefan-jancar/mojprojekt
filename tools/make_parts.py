"""Vygeneruje katalóg bežných súčiastok public/data/parts.json.

kind = schematická značka (circuit.js), pkg = puzdro pre DPS, pins = názvy vývodov (poradie = číslo vývodu).
"""
import json
from pathlib import Path

P = []


def add(cat, name, kind, value="", pkg="", pins=None, desc=""):
    e = {"id": f"p{len(P) + 1}", "cat": cat, "name": name, "kind": kind}
    if value: e["value"] = value
    if pkg: e["pkg"] = pkg
    if pins: e["pins"] = pins
    if desc: e["desc"] = desc
    P.append(e)


for v in ["10 Ω", "47 Ω", "100 Ω", "220 Ω", "330 Ω", "470 Ω", "1 kΩ", "2,2 kΩ", "4,7 kΩ", "10 kΩ", "22 kΩ", "47 kΩ", "100 kΩ", "1 MΩ"]:
    add("Rezistory", f"Rezistor {v}", "resistor", v, "AXIAL", desc="0,25 W")
for v in ["1 kΩ", "10 kΩ", "100 kΩ"]:
    add("Rezistory", f"Potenciometer {v}", "pot", v, "POT")
add("Rezistory", "Trimer 10 kΩ", "pot", "10 kΩ", "POT")
add("Rezistory", "Fotorezistor (LDR)", "ldr", "GL5528", "RAD2")
add("Rezistory", "Termistor NTC 10 kΩ", "thermistor", "10 kΩ", "RAD2")

for v in ["22 pF", "100 pF", "1 nF", "10 nF", "100 nF", "1 µF"]:
    add("Kondenzátory", f"Keramický kondenzátor {v}", "capacitor", v, "RAD2")
for v in ["1 µF", "10 µF", "47 µF", "100 µF", "220 µF", "470 µF", "1000 µF"]:
    add("Kondenzátory", f"Elektrolytický kondenzátor {v}", "electrolytic", v, "RAD2" if v in ("1 µF", "10 µF", "47 µF", "100 µF") else "RAD5", desc="25 V")
for v in ["10 µH", "100 µH", "1 mH"]:
    add("Kondenzátory", f"Tlmivka {v}", "inductor", v, "AXIAL")

add("Diódy", "Dióda 1N4148", "diode", "1N4148", "AXIAL", desc="malá signálová")
add("Diódy", "Dióda 1N4007", "diode", "1N4007", "AXIAL", desc="usmerňovacia 1 A")
add("Diódy", "Schottkyho dióda 1N5819", "diode", "1N5819", "AXIAL")
for v in ["3,3 V", "5,1 V", "12 V"]:
    add("Diódy", f"Zenerova dióda {v}", "zener", v, "AXIAL")
add("Diódy", "Mostíkový usmerňovač 1 A", "ic", "DB107", "DIP", ["~", "~", "+", "-"])

for c in ["červená", "zelená", "žltá", "modrá", "biela"]:
    add("LED", f"LED {c} 5 mm", "led", c, "LED")
add("LED", "LED 3 mm červená", "led", "červená", "LED")
add("LED", "RGB LED (spoločná katóda)", "ic", "RGB", "HDR", ["R", "K", "G", "B"])
add("LED", "Adresovateľná LED WS2812B (pásik)", "ic", "WS2812B", "HDR", ["5V", "DIN", "GND"])
add("LED", "7-segmentový displej (spol. katóda)", "ic", "SC56", "DIP", ["E", "D", "K", "C", "DP", "B", "A", "K2", "F", "G"])

for n, k, v, pk, pins in [
    ("BC547", "npn", "BC547", "TO92", ["C", "B", "E"]), ("BC557", "pnp", "BC557", "TO92", ["C", "B", "E"]),
    ("2N2222", "npn", "2N2222", "TO92", ["E", "B", "C"]), ("2N3904", "npn", "2N3904", "TO92", ["E", "B", "C"]),
    ("2N3906", "pnp", "2N3906", "TO92", ["E", "B", "C"]), ("TIP120 (Darlington)", "npn", "TIP120", "TO220", ["B", "C", "E"]),
    ("BD139", "npn", "BD139", "TO126", ["E", "C", "B"]), ("2N7000", "nmos", "2N7000", "TO92", ["S", "G", "D"]),
    ("BS170", "nmos", "BS170", "TO92", ["D", "G", "S"]), ("IRLZ44N", "nmos", "IRLZ44N", "TO220", ["G", "D", "S"]),
    ("IRF520", "nmos", "IRF520", "TO220", ["G", "D", "S"]), ("IRF9540", "pmos", "IRF9540", "TO220", ["G", "D", "S"]),
]:
    add("Tranzistory", f"Tranzistor {n}", k, v, pk, pins)

IC = [
    ("NE555 časovač", "NE555", "DIP", ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"]),
    ("LM358 dvojitý OZ", "LM358", "DIP", ["OUT1", "IN1-", "IN1+", "GND", "IN2+", "IN2-", "OUT2", "VCC"]),
    ("LM741 operačný zosilňovač", "LM741", "DIP", ["NULL1", "IN-", "IN+", "V-", "NULL2", "OUT", "V+", "NC"]),
    ("LM393 komparátor", "LM393", "DIP", ["OUT1", "IN1-", "IN1+", "GND", "IN2+", "IN2-", "OUT2", "VCC"]),
    ("LM386 NF zosilňovač", "LM386", "DIP", ["GAIN1", "IN-", "IN+", "GND", "OUT", "VS", "BYP", "GAIN8"]),
    ("CD4017 dekádový čítač", "CD4017", "DIP", ["Q5", "Q1", "Q0", "Q2", "Q6", "Q7", "Q3", "VSS", "Q8", "Q4", "Q9", "CO", "EN", "CLK", "RST", "VDD"]),
    ("CD4060 čítač s oscilátorom", "CD4060", "DIP", ["Q12", "Q13", "Q14", "Q6", "Q5", "Q7", "Q4", "VSS", "PHO", "PHI", "PHI1", "RST", "Q9", "Q8", "Q10", "VDD"]),
    ("CD4011 4× NAND", "CD4011", "DIP", ["1A", "1B", "1Y", "2Y", "2A", "2B", "VSS", "3A", "3B", "3Y", "4Y", "4A", "4B", "VDD"]),
    ("74HC00 4× NAND", "74HC00", "DIP", ["1A", "1B", "1Y", "2A", "2B", "2Y", "GND", "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC"]),
    ("74HC14 6× Schmittov invertor", "74HC14", "DIP", ["1A", "1Y", "2A", "2Y", "3A", "3Y", "GND", "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC"]),
    ("74HC595 posuvný register", "74HC595", "DIP", ["QB", "QC", "QD", "QE", "QF", "QG", "QH", "GND", "QH'", "SRCLR", "SRCLK", "RCLK", "OE", "SER", "QA", "VCC"]),
    ("ULN2003 budič 7×", "ULN2003", "DIP", ["IN1", "IN2", "IN3", "IN4", "IN5", "IN6", "IN7", "GND", "COM", "OUT7", "OUT6", "OUT5", "OUT4", "OUT3", "OUT2", "OUT1"]),
    ("L293D budič motorov", "L293D", "DIP", ["EN1", "IN1", "OUT1", "GND", "GND2", "OUT2", "IN2", "VS", "EN2", "IN3", "OUT3", "GND3", "GND4", "OUT4", "IN4", "VSS"]),
    ("PC817 optočlen", "PC817", "DIP", ["A", "K", "E", "C"]),
    ("MOC3021 optotriak", "MOC3021", "DIP", ["A", "K", "NC", "MT1", "NC2", "MT2"]),
    ("ATtiny85 mikrokontrolér", "ATtiny85", "DIP", ["PB5/RST", "PB3", "PB4", "GND", "PB0", "PB1", "PB2", "VCC"]),
    ("ATmega328P mikrokontrolér", "ATmega328P", "DIP", ["RST", "D0", "D1", "D2", "D3", "D4", "VCC", "GND", "XTAL1", "XTAL2", "D5", "D6", "D7", "D8",
                                                         "D9", "D10", "D11", "D12", "D13", "AVCC", "AREF", "GND2", "A0", "A1", "A2", "A3", "A4", "A5"]),
]
for n, v, pk, pins in IC:
    add("Integrované obvody", n, "ic", v, pk, pins)
add("Napájanie", "Stabilizátor 7805 (5 V)", "ic", "7805", "TO220", ["IN", "GND", "OUT"])
add("Napájanie", "Stabilizátor 7812 (12 V)", "ic", "7812", "TO220", ["IN", "GND", "OUT"])
add("Napájanie", "Stabilizátor LM317 (nastaviteľný)", "ic", "LM317", "TO220", ["ADJ", "OUT", "IN"])
add("Napájanie", "Stabilizátor AMS1117 3,3 V", "ic", "AMS1117-3.3", "TO220", ["GND", "OUT", "IN"])
add("Napájanie", "Referencia TL431", "ic", "TL431", "TO92", ["REF", "A", "K"])
add("Napájanie", "Batéria 9 V", "battery", "9 V", "TERM2")
add("Napájanie", "Držiak 2× AA (3 V)", "battery", "3 V", "TERM2")
add("Napájanie", "Držiak 4× AA (6 V)", "battery", "6 V", "TERM2")
add("Napájanie", "Gombíková batéria CR2032", "battery", "3 V", "TERM2")
add("Napájanie", "Li-Ion článok 18650", "battery", "3,7 V", "TERM2")
add("Napájanie", "Napájací konektor DC 5,5/2,1", "connector", "DC jack", "TERM2", ["+", "-"])
add("Napájanie", "USB-C napájací modul", "module", "USB-C", "HDR", ["VBUS", "GND"])
add("Napájanie", "Nabíjačka Li-Ion TP4056", "module", "TP4056", "HDR", ["IN+", "IN-", "B+", "B-", "OUT+", "OUT-"])
add("Napájanie", "Step-up MT3608", "module", "MT3608", "HDR", ["VIN+", "VIN-", "VOUT+", "VOUT-"])
add("Napájanie", "Step-down LM2596", "module", "LM2596", "HDR", ["IN+", "IN-", "OUT+", "OUT-"])
add("Napájanie", "Poistka 500 mA", "fuse", "500 mA", "AXIAL")

NANO = ["D1/TX", "D0/RX", "RST", "GND", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12",
        "D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST2", "GND2", "VIN"]
add("Mikrokontroléry", "Arduino Nano", "module", "ATmega328P", "HDR", NANO)
add("Mikrokontroléry", "Arduino Uno", "module", "ATmega328P", "HDR",
    ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "A0", "A1", "A2", "A3", "A4", "A5", "5V", "3V3", "VIN", "GND"])
add("Mikrokontroléry", "Arduino Pro Mini", "module", "ATmega328P", "HDR",
    ["D0", "D1", "RST", "GND", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "A0", "A1", "A2", "A3", "VCC", "RAW"])
add("Mikrokontroléry", "ESP32 DevKit", "module", "ESP32", "HDR",
    ["3V3", "GND", "GPIO15", "GPIO2", "GPIO4", "GPIO16", "GPIO17", "GPIO5", "GPIO18", "GPIO19", "GPIO21", "GPIO22", "GPIO23",
     "VIN", "GPIO13", "GPIO12", "GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "EN"])
add("Mikrokontroléry", "ESP8266 NodeMCU", "module", "ESP8266", "HDR",
    ["A0", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "RX", "TX", "3V3", "GND", "VIN"])
add("Mikrokontroléry", "ESP-01 (ESP8266)", "module", "ESP-01", "HDR", ["GND", "GPIO2", "GPIO0", "RX", "TX", "CH_PD", "RST", "VCC"])
add("Mikrokontroléry", "Raspberry Pi Pico", "module", "RP2040", "HDR",
    ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9", "GP10", "GP11", "GP12", "GP13", "GP14", "GP15",
     "GP16", "GP17", "GP18", "GP19", "GP20", "GP21", "GP22", "GP26", "GP27", "GP28", "3V3", "VSYS", "VBUS"])
add("Mikrokontroléry", "Digispark ATtiny85", "module", "ATtiny85", "HDR", ["P0", "P1", "P2", "P3", "P4", "P5", "5V", "GND", "VIN"])
add("Mikrokontroléry", "Kryštál 16 MHz", "crystal", "16 MHz", "RAD5")

S = [
    ("Teplotný senzor DS18B20", "DS18B20", "TO92", ["GND", "DQ", "VDD"], "ic"),
    ("Teplotný senzor LM35", "LM35", "TO92", ["VS", "VOUT", "GND"], "ic"),
    ("Teplota a vlhkosť DHT11", "DHT11", "HDR", ["VCC", "DATA", "GND"], "module"),
    ("Teplota a vlhkosť DHT22", "DHT22", "HDR", ["VCC", "DATA", "GND"], "module"),
    ("Ultrazvukový senzor HC-SR04", "HC-SR04", "HDR", ["VCC", "TRIG", "ECHO", "GND"], "module"),
    ("PIR senzor pohybu HC-SR501", "HC-SR501", "HDR", ["VCC", "OUT", "GND"], "module"),
    ("IR prijímač VS1838B", "VS1838B", "TO92", ["OUT", "GND", "VCC"], "ic"),
    ("Senzor vlhkosti pôdy", "pôda", "HDR", ["VCC", "GND", "AO", "DO"], "module"),
    ("Senzor dažďa", "dážď", "HDR", ["VCC", "GND", "AO", "DO"], "module"),
    ("Mikrofónový modul", "KY-038", "HDR", ["AO", "GND", "VCC", "DO"], "module"),
    ("Akcelerometer a gyroskop MPU6050", "MPU6050", "HDR", ["VCC", "GND", "SCL", "SDA", "XDA", "XCL", "AD0", "INT"], "module"),
    ("Tlak a teplota BMP280", "BMP280", "HDR", ["VCC", "GND", "SCL", "SDA", "CSB", "SDO"], "module"),
    ("Hodiny reálneho času DS3231", "DS3231", "HDR", ["GND", "VCC", "SDA", "SCL", "SQW", "32K"], "module"),
    ("Hallov senzor A3144", "A3144", "TO92", ["VCC", "GND", "OUT"], "ic"),
    ("Snímač prúdu ACS712", "ACS712", "HDR", ["VCC", "OUT", "GND", "IP+", "IP-"], "module"),
    ("Snímač plynu MQ-2", "MQ-2", "HDR", ["VCC", "GND", "DO", "AO"], "module"),
    ("Rotačný enkodér KY-040", "KY-040", "HDR", ["GND", "+", "SW", "DT", "CLK"], "module"),
    ("Joystick modul", "joystick", "HDR", ["GND", "+5V", "VRX", "VRY", "SW"], "module"),
    ("Jazýčkový kontakt", "reed", "AXIAL", None, "switch"),
    ("Snímač náklonu", "tilt", "RAD2", None, "switch"),
]
for n, v, pk, pins, k in S:
    add("Senzory", n, k, v, pk, pins)

M = [
    ("OLED displej 0,96\" I2C", "SSD1306", ["GND", "VCC", "SCL", "SDA"]),
    ("LCD 16×2 s I2C", "LCD1602", ["GND", "VCC", "SDA", "SCL"]),
    ("Maticový displej MAX7219", "MAX7219", ["VCC", "GND", "DIN", "CS", "CLK"]),
    ("Modul relé 1×", "relé 5 V", ["VCC", "GND", "IN", "COM", "NO", "NC"]),
    ("Budič motorov L298N", "L298N", ["12V", "GND", "5V", "ENA", "IN1", "IN2", "IN3", "IN4", "ENB", "OUT1", "OUT2", "OUT3", "OUT4"]),
    ("Budič krokového motora ULN2003", "ULN2003", ["IN1", "IN2", "IN3", "IN4", "+", "-"]),
    ("Bluetooth HC-05", "HC-05", ["EN", "VCC", "GND", "TXD", "RXD", "STATE"]),
    ("RFID čítačka RC522", "RC522", ["SDA", "SCK", "MOSI", "MISO", "IRQ", "GND", "RST", "3V3"]),
    ("Modul SD karty", "SD", ["GND", "VCC", "MISO", "MOSI", "SCK", "CS"]),
    ("Klávesnica 4×4", "keypad", ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"]),
    ("MOSFET modul", "IRF520", ["SIG", "VCC", "GND", "V+", "V-", "VIN", "GND2"]),
    ("Rádio nRF24L01", "nRF24L01", ["GND", "VCC", "CE", "CSN", "SCK", "MOSI", "MISO", "IRQ"]),
    ("GPS NEO-6M", "NEO-6M", ["VCC", "RX", "TX", "GND"]),
    ("MP3 prehrávač DFPlayer Mini", "DFPlayer", ["VCC", "RX", "TX", "DAC_R", "DAC_L", "SPK1", "GND", "SPK2"]),
]
for n, v, pins in M:
    add("Moduly a displeje", n, "module", v, "HDR", pins)

add("Akčné členy", "Servo SG90", "module", "SG90", "HDR", ["GND", "VCC", "SIG"])
add("Akčné členy", "Krokový motor 28BYJ-48", "module", "28BYJ-48", "HDR", ["A", "B", "C", "D", "+"])
add("Akčné členy", "DC motor", "motor", "3–6 V", "TERM2")
add("Akčné členy", "Vibračný motorček", "motor", "3 V", "TERM2")
add("Akčné členy", "Relé 5 V (samostatné)", "ic", "SRD-05VDC", "RELAY", ["COIL1", "COIL2", "COM", "NO", "NC"])
add("Akčné členy", "Bzučiak aktívny 5 V", "buzzer", "aktívny", "RAD5")
add("Akčné členy", "Piezo pasívny", "buzzer", "pasívny", "RAD5")
add("Akčné členy", "Reproduktor 8 Ω", "speaker", "8 Ω 0,5 W", "TERM2")

add("Spínače a konektory", "Tlačidlo 6×6 mm", "button", "", "BTN")
add("Spínače a konektory", "Posuvný prepínač", "switch", "", "HDR")
add("Spínače a konektory", "Páčkový vypínač", "switch", "", "TERM2")
add("Spínače a konektory", "DIP prepínač 4×", "ic", "DIP4", "DIP", ["1", "2", "3", "4", "5", "6", "7", "8"])
add("Spínače a konektory", "Kolíková lišta 2-pin", "connector", "2 pin", "HDR", ["1", "2"])
add("Spínače a konektory", "Kolíková lišta 3-pin", "connector", "3 pin", "HDR", ["1", "2", "3"])
add("Spínače a konektory", "Kolíková lišta 4-pin", "connector", "4 pin", "HDR", ["1", "2", "3", "4"])
add("Spínače a konektory", "Svorkovnica 2-pin", "connector", "5,08 mm", "TERM2", ["1", "2"])

add("Pomôcky", "Nepájivé pole", "tool", "830 bodov")
add("Pomôcky", "Prepojovacie káble", "tool", "M-M, M-F")
add("Pomôcky", "Univerzálna DPS", "tool", "")
add("Pomôcky", "Multimeter", "tool", "")
add("Pomôcky", "Spájkovačka", "tool", "")

out = Path(__file__).resolve().parent.parent / "public/data/parts.json"
out.write_text(json.dumps(P, ensure_ascii=False, separators=(",", ":")))
print(len(P), "súčiastok →", out)
