;; VM_SAMPLE_PEAK_WASM_BASE64 (embedded in index.html)
;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.
;; Embedded module: 518 bytes; executable sections: 244 bytes.
(module $sample_peak.wasm
  (type $t0 (func (param i32 i32) (result f64)))
  (func $vm_sample_peak_scan (type $t0) (param $p0 i32) (param $p1 i32) (result f64)
    (local $l2 f64) (local $l3 f64) (local $l4 f32) (local $l5 f64)
    (block $B0
      (br_if $B0
        (i32.ge_s
          (local.get $p1)
          (i32.const 1)))
      (return
        (f64.const 0x0p+0 (;=0;))))
    (local.set $l2
      (f64.const 0x0p+0 (;=0;)))
    (block $B1
      (loop $L2
        (local.set $l3
          (f64.const nan (;=nan;)))
        (br_if $B1
          (f64.lt
            (local.tee $l5
              (f64.promote_f32
                (local.tee $l4
                  (f32.load
                    (local.get $p0)))))
            (f64.const -0x1.7e43c8800759cp+996 (;=-1e+300;))))
        (br_if $B1
          (f32.ne
            (local.get $l4)
            (local.get $l4)))
        (br_if $B1
          (f64.gt
            (local.get $l5)
            (f64.const 0x1.7e43c8800759cp+996 (;=1e+300;))))
        (local.set $p0
          (i32.add
            (local.get $p0)
            (i32.const 4)))
        (local.set $l3
          (local.tee $l2
            (select
              (local.tee $l5
                (select
                  (f64.neg
                    (local.get $l5))
                  (local.get $l5)
                  (f32.lt
                    (local.get $l4)
                    (f32.const 0x0p+0 (;=0;)))))
              (local.get $l2)
              (f64.gt
                (local.get $l5)
                (local.get $l2)))))
        (br_if $L2
          (local.tee $p1
            (i32.add
              (local.get $p1)
              (i32.const -1))))))
    (local.get $l3))
  (memory $memory 16 1024)
  (global $__stack_pointer (mut i32) (i32.const 66560))
  (global $__heap_base i32 (i32.const 66560))
  (export "memory" (memory $memory))
  (export "vm_sample_peak_scan" (func $vm_sample_peak_scan))
  (export "__heap_base" (global $__heap_base)))
