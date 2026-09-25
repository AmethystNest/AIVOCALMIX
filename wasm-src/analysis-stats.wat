;; VM_ANALYSIS_STATS_WASM_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 773 bytes; executable sections: 478 bytes.
(module $stats.wasm
  (type $t0 (func (param i32 i32 i32) (result i32)))
  (type $t1 (func (param i32 i32 i32 i32) (result i32)))
  (func $vm_peak_rms_accumulate (type $t0) (param $p0 i32) (param $p1 i32) (param $p2 i32) (result i32)
    (local $l3 f64) (local $l4 f64) (local $l5 i32) (local $l6 f32) (local $l7 f64) (local $l8 f64)
    (local.set $l3
      (f64.load offset=8
        (local.get $p2)))
    (local.set $l4
      (f64.load
        (local.get $p2)))
    (block $B0
      (block $B1
        (br_if $B1
          (i32.lt_s
            (local.get $p1)
            (i32.const 1)))
        (loop $L2
          (local.set $l5
            (i32.const 0))
          (br_if $B0
            (f64.lt
              (local.tee $l7
                (f64.promote_f32
                  (local.tee $l6
                    (f32.load
                      (local.get $p0)))))
              (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;))))
          (br_if $B0
            (f32.ne
              (local.get $l6)
              (local.get $l6)))
          (br_if $B0
            (f64.gt
              (local.get $l7)
              (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
          (local.set $l4
            (select
              (local.tee $l8
                (select
                  (f64.neg
                    (local.get $l7))
                  (local.get $l7)
                  (f32.lt
                    (local.get $l6)
                    (f32.const 0x0p+0 (;=0;)))))
              (local.get $l4)
              (f64.gt
                (local.get $l8)
                (local.get $l4))))
          (local.set $p0
            (i32.add
              (local.get $p0)
              (i32.const 4)))
          (local.set $l3
            (f64.add
              (f64.mul
                (local.get $l7)
                (local.get $l7))
              (local.get $l3)))
          (br_if $L2
            (local.tee $p1
              (i32.add
                (local.get $p1)
                (i32.const -1))))))
      (f64.store offset=8
        (local.get $p2)
        (local.get $l3))
      (f64.store
        (local.get $p2)
        (local.get $l4))
      (local.set $l5
        (i32.const 1)))
    (local.get $l5))
  (func $vm_pair_rms_accumulate (type $t1) (param $p0 i32) (param $p1 i32) (param $p2 i32) (param $p3 i32) (result i32)
    (local $l4 f64) (local $l5 f64) (local $l6 i32) (local $l7 f32) (local $l8 f64) (local $l9 f64)
    (local.set $l4
      (f64.load offset=8
        (local.get $p3)))
    (local.set $l5
      (f64.load
        (local.get $p3)))
    (block $B0
      (block $B1
        (br_if $B1
          (i32.lt_s
            (local.get $p2)
            (i32.const 1)))
        (loop $L2
          (local.set $l6
            (i32.const 0))
          (br_if $B0
            (f32.ne
              (local.tee $l7
                (f32.load
                  (local.get $p0)))
              (local.get $l7)))
          (br_if $B0
            (f64.lt
              (local.tee $l8
                (f64.promote_f32
                  (local.get $l7)))
              (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;))))
          (br_if $B0
            (f32.ne
              (local.tee $l7
                (f32.load
                  (local.get $p1)))
              (local.get $l7)))
          (br_if $B0
            (f64.gt
              (local.get $l8)
              (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
          (br_if $B0
            (f64.gt
              (f64.abs
                (local.tee $l9
                  (f64.promote_f32
                    (local.get $l7))))
              (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
          (local.set $p0
            (i32.add
              (local.get $p0)
              (i32.const 4)))
          (local.set $p1
            (i32.add
              (local.get $p1)
              (i32.const 4)))
          (local.set $l4
            (f64.add
              (f64.mul
                (local.get $l9)
                (local.get $l9))
              (local.get $l4)))
          (local.set $l5
            (f64.add
              (f64.mul
                (local.get $l8)
                (local.get $l8))
              (local.get $l5)))
          (br_if $L2
            (local.tee $p2
              (i32.add
                (local.get $p2)
                (i32.const -1))))))
      (f64.store offset=8
        (local.get $p3)
        (local.get $l4))
      (f64.store
        (local.get $p3)
        (local.get $l5))
      (local.set $l6
        (i32.const 1)))
    (local.get $l6))
  (memory $memory 16 1024)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__heap_base i32 (i32.const 66560))
  (export "memory" (memory $memory))
  (export "vm_peak_rms_accumulate" (func $vm_peak_rms_accumulate))
  (export "vm_pair_rms_accumulate" (func $vm_pair_rms_accumulate))
  (export "__heap_base" (global $__heap_base)))
