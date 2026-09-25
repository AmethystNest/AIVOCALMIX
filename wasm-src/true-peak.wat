;; VM_TRUE_PEAK_WASM_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 1387 bytes; executable sections: 1124 bytes.
(module $tp.wasm
  (type $t0 (func (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32) (result f64)))
  (func $vm_true_peak_scan (type $t0) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (param $p4 i32) (param $p5 i32) (param $p6 i32) (param $p7 i32) (param $p8 i32) (param $p9 i32) (result f64)
    (local $l10 f64) (local $l11 i32) (local $l12 f64) (local $l13 f32) (local $l14 f64) (local $l15 i32) (local $l16 i32) (local $l17 i32) (local $l18 i32) (local $l19 i32) (local $l20 i32) (local $l21 i32) (local $l22 i32) (local $l23 i32) (local $l24 i32) (local $l25 i32)
    (local.set $l10
      (f64.const 0x0p+0 (;=0;)))
    (block $B0
      (br_if $B0
        (i32.le_s
          (local.get $p7)
          (local.get $p6)))
      (block $B1
        (br_if $B1
          (i32.gt_s
            (local.get $p3)
            (i32.const 0)))
        (local.set $l11
          (i32.sub
            (local.get $p7)
            (local.get $p6)))
        (local.set $p9
          (i32.add
            (local.get $p0)
            (i32.shl
              (local.get $p6)
              (i32.const 2))))
        (local.set $l12
          (f64.const 0x0p+0 (;=0;)))
        (loop $L2
          (local.set $l10
            (f64.const nan (;=nan;)))
          (br_if $B0
            (f64.lt
              (local.tee $l14
                (f64.promote_f32
                  (local.tee $l13
                    (f32.load
                      (local.get $p9)))))
              (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;))))
          (br_if $B0
            (f32.ne
              (local.get $l13)
              (local.get $l13)))
          (br_if $B0
            (f64.gt
              (local.get $l14)
              (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
          (local.set $p9
            (i32.add
              (local.get $p9)
              (i32.const 4)))
          (local.set $l10
            (local.tee $l12
              (select
                (local.tee $l14
                  (select
                    (f64.neg
                      (local.get $l14))
                    (local.get $l14)
                    (f32.lt
                      (local.get $l13)
                      (f32.const 0x0p+0 (;=0;)))))
                (local.get $l12)
                (f64.gt
                  (local.get $l14)
                  (local.get $l12)))))
          (br_if $L2
            (local.tee $l11
              (i32.add
                (local.get $l11)
                (i32.const -1))))
          (br $B0)))
      (local.set $l15
        (i32.add
          (local.get $p9)
          (i32.const -1)))
      (block $B3
        (br_if $B3
          (i32.gt_s
            (local.get $p4)
            (i32.const 0)))
        (local.set $l16
          (i32.and
            (local.get $p3)
            (i32.const 2147483640)))
        (local.set $l11
          (i32.and
            (local.get $p3)
            (i32.const 7)))
        (local.set $p1
          (i32.lt_u
            (local.get $p3)
            (i32.const 8)))
        (local.set $l10
          (f64.const 0x0p+0 (;=0;)))
        (loop $L4
          (local.set $l12
            (local.get $l10))
          (local.set $l10
            (f64.const nan (;=nan;)))
          (br_if $B0
            (f64.lt
              (local.tee $l14
                (f64.promote_f32
                  (local.tee $l13
                    (f32.load
                      (i32.add
                        (local.get $p0)
                        (i32.shl
                          (local.get $p6)
                          (i32.const 2)))))))
              (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;))))
          (br_if $B0
            (f32.ne
              (local.get $l13)
              (local.get $l13)))
          (br_if $B0
            (f64.gt
              (local.get $l14)
              (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
          (local.set $l10
            (select
              (local.tee $l14
                (select
                  (f64.neg
                    (local.get $l14))
                  (local.get $l14)
                  (f32.lt
                    (local.get $l13)
                    (f32.const 0x0p+0 (;=0;)))))
              (local.get $l12)
              (f64.gt
                (local.get $l14)
                (local.get $l12))))
          (block $B5
            (br_if $B5
              (i32.ge_s
                (i32.add
                  (local.get $p6)
                  (local.get $p8))
                (local.get $l15)))
            (local.set $p9
              (local.get $l16))
            (block $B6
              (br_if $B6
                (local.get $p1))
              (loop $L7
                (local.set $l10
                  (select
                    (f64.const 0x0p+0 (;=0;))
                    (local.get $l10)
                    (f64.lt
                      (local.get $l10)
                      (f64.const 0x0p+0 (;=0;)))))
                (br_if $L7
                  (local.tee $p9
                    (i32.add
                      (local.get $p9)
                      (i32.const -8))))))
            (br_if $B5
              (i32.eqz
                (local.get $l11)))
            (local.set $p9
              (local.get $l11))
            (loop $L8
              (local.set $l10
                (select
                  (f64.const 0x0p+0 (;=0;))
                  (local.get $l10)
                  (f64.lt
                    (local.get $l10)
                    (f64.const 0x0p+0 (;=0;)))))
              (br_if $L8
                (local.tee $p9
                  (i32.add
                    (local.get $p9)
                    (i32.const -1))))))
          (br_if $B0
            (i32.eq
              (local.tee $p6
                (i32.add
                  (local.get $p6)
                  (i32.const 1)))
              (local.get $p7)))
          (br $L4)))
      (local.set $l17
        (i32.add
          (i32.add
            (i32.sub
              (i32.shl
                (local.get $p6)
                (i32.const 2))
              (i32.shl
                (local.get $p5)
                (i32.const 2)))
            (local.get $p0))
          (i32.const 8)))
      (local.set $l18
        (i32.shl
          (local.get $p4)
          (i32.const 3)))
      (local.set $l19
        (i32.sub
          (local.get $p6)
          (local.get $p5)))
      (local.set $l20
        (i32.and
          (local.get $p4)
          (i32.const 2147483646)))
      (local.set $l21
        (i32.and
          (local.get $p4)
          (i32.const 1)))
      (local.set $l10
        (f64.const 0x0p+0 (;=0;)))
      (loop $L9
        (block $B10
          (br_if $B10
            (i32.eqz
              (f64.lt
                (local.tee $l14
                  (f64.promote_f32
                    (local.tee $l13
                      (f32.load
                        (i32.add
                          (local.get $p0)
                          (i32.shl
                            (local.get $p6)
                            (i32.const 2)))))))
                (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;)))))
          (return
            (f64.const nan (;=nan;))))
        (block $B11
          (br_if $B11
            (f32.eq
              (local.get $l13)
              (local.get $l13)))
          (return
            (f64.const nan (;=nan;))))
        (block $B12
          (br_if $B12
            (i32.eqz
              (f64.gt
                (local.get $l14)
                (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;)))))
          (return
            (f64.const nan (;=nan;))))
        (local.set $l10
          (select
            (local.tee $l14
              (select
                (f64.neg
                  (local.get $l14))
                (local.get $l14)
                (f32.lt
                  (local.get $l13)
                  (f32.const 0x0p+0 (;=0;)))))
            (local.get $l10)
            (f64.gt
              (local.get $l14)
              (local.get $l10))))
        (block $B13
          (br_if $B13
            (i32.ge_s
              (i32.add
                (local.get $p6)
                (local.get $p8))
              (local.get $l15)))
          (local.set $l22
            (i32.add
              (i32.sub
                (local.get $p6)
                (local.get $p5))
              (i32.const 1)))
          (local.set $l23
            (i32.const 0))
          (local.set $l24
            (local.get $p2))
          (loop $L14
            (local.set $l14
              (f64.const 0x0p+0 (;=0;)))
            (local.set $p9
              (i32.const 0))
            (block $B15
              (br_if $B15
                (i32.eq
                  (local.get $p4)
                  (i32.const 1)))
              (local.set $l14
                (f64.const 0x0p+0 (;=0;)))
              (local.set $p9
                (i32.const 0))
              (local.set $l11
                (local.get $l24))
              (local.set $l16
                (local.get $l17))
              (loop $L16
                (block $B17
                  (br_if $B17
                    (i32.ge_u
                      (i32.add
                        (local.tee $l25
                          (i32.add
                            (local.get $l19)
                            (local.get $p9)))
                        (i32.const 1))
                      (local.get $p1)))
                  (local.set $l14
                    (f64.add
                      (f64.mul
                        (f64.promote_f32
                          (f32.load
                            (i32.add
                              (local.get $l16)
                              (i32.const -4))))
                        (f64.load
                          (local.get $l11)))
                      (local.get $l14))))
                (block $B18
                  (br_if $B18
                    (i32.ge_u
                      (i32.add
                        (local.get $l25)
                        (i32.const 2))
                      (local.get $p1)))
                  (local.set $l14
                    (f64.add
                      (f64.mul
                        (f64.promote_f32
                          (f32.load
                            (local.get $l16)))
                        (f64.load
                          (i32.add
                            (local.get $l11)
                            (i32.const 8))))
                      (local.get $l14))))
                (local.set $l11
                  (i32.add
                    (local.get $l11)
                    (i32.const 16)))
                (local.set $l16
                  (i32.add
                    (local.get $l16)
                    (i32.const 8)))
                (br_if $L16
                  (i32.ne
                    (local.get $l20)
                    (local.tee $p9
                      (i32.add
                        (local.get $p9)
                        (i32.const 2)))))))
            (block $B19
              (br_if $B19
                (i32.eqz
                  (local.get $l21)))
              (br_if $B19
                (i32.ge_u
                  (local.tee $l11
                    (i32.add
                      (local.get $l22)
                      (local.get $p9)))
                  (local.get $p1)))
              (local.set $l14
                (f64.add
                  (f64.mul
                    (f64.promote_f32
                      (f32.load
                        (i32.add
                          (local.get $p0)
                          (i32.shl
                            (local.get $l11)
                            (i32.const 2)))))
                    (f64.load
                      (i32.add
                        (i32.add
                          (local.get $p2)
                          (i32.shl
                            (i32.mul
                              (local.get $l23)
                              (local.get $p4))
                            (i32.const 3)))
                        (i32.shl
                          (local.get $p9)
                          (i32.const 3)))))
                  (local.get $l14))))
            (block $B20
              (br_if $B20
                (i32.eqz
                  (f64.lt
                    (local.get $l14)
                    (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;)))))
              (return
                (f64.const nan (;=nan;))))
            (block $B21
              (br_if $B21
                (f64.eq
                  (local.get $l14)
                  (local.get $l14)))
              (return
                (f64.const nan (;=nan;))))
            (block $B22
              (br_if $B22
                (i32.eqz
                  (f64.gt
                    (local.get $l14)
                    (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;)))))
              (return
                (f64.const nan (;=nan;))))
            (local.set $l10
              (select
                (local.tee $l14
                  (select
                    (f64.neg
                      (local.get $l14))
                    (local.get $l14)
                    (f64.lt
                      (local.get $l14)
                      (f64.const 0x0p+0 (;=0;)))))
                (local.get $l10)
                (f64.gt
                  (local.get $l14)
                  (local.get $l10))))
            (local.set $l24
              (i32.add
                (local.get $l24)
                (local.get $l18)))
            (br_if $L14
              (i32.ne
                (local.tee $l23
                  (i32.add
                    (local.get $l23)
                    (i32.const 1)))
                (local.get $p3)))))
        (local.set $l19
          (i32.add
            (local.get $l19)
            (i32.const 1)))
        (local.set $l17
          (i32.add
            (local.get $l17)
            (i32.const 4)))
        (br_if $L9
          (i32.ne
            (local.tee $p6
              (i32.add
                (local.get $p6)
                (i32.const 1)))
            (local.get $p7)))))
    (local.get $l10))
  (memory $memory 16 1024)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__heap_base i32 (i32.const 66560))
  (export "memory" (memory $memory))
  (export "vm_true_peak_scan" (func $vm_true_peak_scan))
  (export "__heap_base" (global $__heap_base)))
