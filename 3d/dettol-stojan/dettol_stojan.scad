// Nástenný stojan na tekuté mydlo Dettol Soft on Skin 250 ml
// Tlač: Ender 3 Pro, PETG (do kúpeľne) alebo PLA, tlačiť VZPRIAMENE
// (dno košíka na podložke, zadná doska kolmo hore) – bez podpier.
//
// Rozmery fľaše si odmerajte posuvkou v najširšom mieste spodnej časti
// a upravte parametre nižšie (ostatné sa prepočíta samo).

/* [Fľaša] */
flasa_sirka  = 85;   // šírka fľaše (zľava doprava)
flasa_hlbka  = 40;   // hĺbka fľaše (spredu dozadu)
flasa_radius = 18;   // zaoblenie rohov pôdorysu fľaše
vola         = 1.5;  // vôľa na každú stranu

/* [Košík] */
stena       = 2.8;   // hrúbka steny košíka (7 perimetrov pri 0,4 mm dýze)
dno         = 3;     // hrúbka dna
vyska_kosik = 45;    // výška košíka (vonkajšia)
vyrez_sirka = 44;    // šírka predného výrezu (vidno etiketu)
vyrez_od_dna = 15;   // od akej výšky začína predný výrez
odtok_d     = 6;     // priemer odtokových otvorov v dne

/* [Zadná doska] */
doska_hrubka = 4;
doska_vyska  = 100;
skrutka_d    = 4.5;  // otvor pre skrutku 4 mm
hlava_d      = 9;    // priemer zápustnej hlavy
skrutky_rozostup = 56;
skrutky_od_vrchu = 15;

$fn = 64;

in_w = flasa_sirka + 2*vola;
in_d = flasa_hlbka + 2*vola;
in_r = flasa_radius + vola;
out_w = in_w + 2*stena;
out_d = in_d + stena + doska_hrubka;   // zadná stena košíka = doska

module rrect(w, d, r, h) {
    // zaoblený obdĺžnik, stred v X, zadná hrana na y=0
    hull() for (x = [-w/2 + r, w/2 - r], y = [r, d - r])
        translate([x, y, 0]) cylinder(r = r, h = h);
}

module kosik() {
    difference() {
        // vonkajší tvar – zadné rohy rovné, aby sedel na dosku
        hull() {
            translate([-out_w/2, 0, 0]) cube([out_w, 1, vyska_kosik]);
            translate([0, 0, 0]) rrect(out_w, out_d, in_r + stena, vyska_kosik);
        }
        // dutina
        translate([0, doska_hrubka, dno]) rrect(in_w, in_d, in_r, vyska_kosik);
        // predný výrez so zaobleným spodkom
        translate([0, out_d - stena - 1, vyrez_od_dna + vyrez_sirka/2])
            rotate([-90, 0, 0]) hull() {
                cylinder(d = vyrez_sirka, h = stena + 2);
                translate([0, -vyska_kosik, 0]) cylinder(d = vyrez_sirka, h = stena + 2);
            }
        // odtokové otvory 3 x 2
        for (x = [-1, 0, 1], y = [-1, 1])
            translate([x * 22, doska_hrubka + in_d/2 + y * 12, -1])
                cylinder(d = odtok_d, h = dno + 2);
    }
}

module doska() {
    r = 8;
    difference() {
        hull() {
            translate([-out_w/2, 0, 0]) cube([out_w, doska_hrubka, 1]);
            for (x = [-out_w/2 + r, out_w/2 - r])
                translate([x, 0, doska_vyska - r]) rotate([-90, 0, 0])
                    cylinder(r = r, h = doska_hrubka);
        }
        for (x = [-skrutky_rozostup/2, skrutky_rozostup/2])
            translate([x, 0, doska_vyska - skrutky_od_vrchu]) {
                rotate([-90, 0, 0]) translate([0, 0, -1])
                    cylinder(d = skrutka_d, h = doska_hrubka + 2);
                // zápustná hlava (90°), otvorená dopredu
                translate([0, doska_hrubka - (hlava_d - skrutka_d)/2 + 0.01, 0])
                    rotate([-90, 0, 0])
                        cylinder(d1 = skrutka_d, d2 = hlava_d, h = (hlava_d - skrutka_d)/2);
            }
    }
}

module vystuhy() {
    // bočné trojuholníkové výstuhy medzi košíkom a doskou
    v = doska_vyska - vyska_kosik - 28;
    for (x = [-out_w/2, out_w/2 - stena])
        translate([x, 0, vyska_kosik - 0.01]) rotate([90, 0, 90])
            linear_extrude(stena)
                polygon([[0, 0], [out_d * 0.45, 0], [0, v]]);
}

union() {
    kosik();
    doska();
    vystuhy();
}
