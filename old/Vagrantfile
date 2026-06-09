Vagrant.configure("2") do |config|
  # Sử dụng box Ubuntu 24.04 (hoặc 22.04 tuỳ chọn, ở đây dùng bản generic mới nhất)
  # Bản generic/ubuntu2404 rất ổn định và sát với môi trường thực tế
  config.vm.box = "bento/ubuntu-24.04"

  # --- Cấu hình Provision chung (Tạo user zett) ---
  $provision_script = <<-SCRIPT
    # Cập nhật repository
    apt-get update -y
    
    # Tạo user zett nếu chưa tồn tại
    if ! id -u zett > /dev/null 2>&1; then
      useradd -m -s /bin/bash zett
      echo "zett:8880" | chpasswd
      usermod -aG sudo zett
      
      # (Tùy chọn) Cho phép zett chạy sudo không cần mật khẩu để tiện lợi trong Lab
      echo "zett ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/99_zett
      chmod 440 /etc/sudoers.d/99_zett
    fi

    # Cho phép SSH bằng Password
    sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
    sed -i 's/^#PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
    sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
    systemctl restart ssh || systemctl restart sshd
  SCRIPT

  # --- Định nghĩa 5 Máy Ảo theo đúng mô hình Lab ---

  # 1. VM1: head-gateway
  config.vm.define "vm1" do |node|
    node.vm.hostname = "head-gateway"
    # Adapter 1 mặc định là NAT (Vagrant tự cấu hình)
    # Adapter 2: Host-only #1 (LAN HEAD)
    node.vm.network "private_network", ip: "192.168.56.10", name: "VirtualBox Host-Only Ethernet Adapter"
    
    node.vm.provider "virtualbox" do |vb|
      vb.name = "VM1-head-gateway"
      vb.memory = "2048"
      vb.cpus = 2
    end
    node.vm.provision "shell", inline: $provision_script
  end

  # 2. VM2: head-server
  config.vm.define "vm2" do |node|
    node.vm.hostname = "head-server"
    # Adapter 2: Host-only #1 (LAN HEAD)
    node.vm.network "private_network", ip: "192.168.56.11", name: "VirtualBox Host-Only Ethernet Adapter"
    
    node.vm.provider "virtualbox" do |vb|
      vb.name = "VM2-head-server"
      vb.memory = "2048"
      vb.cpus = 2
    end
    node.vm.provision "shell", inline: $provision_script
  end

  # 3. VM3: remote-client
  config.vm.define "vm3" do |node|
    node.vm.hostname = "remote-client"
    # Adapter 1 mặc định là NAT
    # Adapter 2: Host-only #2 (Home LAN - Remote)
    node.vm.network "private_network", ip: "192.168.147.10", name: "VirtualBox Host-Only Ethernet Adapter #2"
    
    node.vm.provider "virtualbox" do |vb|
      vb.name = "VM3-remote-client"
      vb.memory = "2048"
      vb.cpus = 2
    end
    node.vm.provision "shell", inline: $provision_script
  end

  # 4. VM4: branch-gateway
  config.vm.define "vm4" do |node|
    node.vm.hostname = "branch-gateway"
    # Adapter 1 mặc định là NAT
    # Adapter 2: Host-only #3 (LAN Branch)
    node.vm.network "private_network", ip: "192.168.57.10", name: "VirtualBox Host-Only Ethernet Adapter #3"
    
    node.vm.provider "virtualbox" do |vb|
      vb.name = "VM4-branch-gateway"
      vb.memory = "2048"
      vb.cpus = 2
    end
    node.vm.provision "shell", inline: $provision_script
  end

  # 5. VM5: branch-client
  config.vm.define "vm5" do |node|
    node.vm.hostname = "branch-client"
    # Adapter 2: Host-only #3 (LAN Branch)
    node.vm.network "private_network", ip: "192.168.57.11", name: "VirtualBox Host-Only Ethernet Adapter #3"
    
    node.vm.provider "virtualbox" do |vb|
      vb.name = "VM5-branch-client"
      vb.memory = "2048"
      vb.cpus = 2
    end
    node.vm.provision "shell", inline: $provision_script
  end

end
